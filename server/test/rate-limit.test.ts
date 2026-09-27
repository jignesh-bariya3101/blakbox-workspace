import { Controller, Get, Module, UseGuards } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { NestFactory } from "@nestjs/core";
import { Throttle, ThrottlerModule } from "@nestjs/throttler";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HttpExceptionFilter } from "../src/common/http-exception.filter";
import { clientIp, IpThrottlerGuard } from "../src/common/rate-limit";
import { requestIdMiddleware } from "../src/common/request-id";

@Controller()
class LimitedController {
  @Get("limited")
  @UseGuards(IpThrottlerGuard)
  @Throttle({ default: { limit: 2, ttl: 60_000 } })
  limited() {
    return { ok: true };
  }
}

@Module({
  imports: [ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 2 }] })],
  controllers: [LimitedController],
  providers: [IpThrottlerGuard, { provide: APP_FILTER, useClass: HttpExceptionFilter }],
})
class LimitedModule {}

describe("rate limiting", () => {
  it("keys by socket address and ignores X-Forwarded-For", () => {
    const first = clientIp({ socket: { remoteAddress: "127.0.0.1" } as never });
    const second = clientIp({ socket: { remoteAddress: "127.0.0.1" } as never });
    expect(first).toBe("127.0.0.1");
    expect(first).toBe(second);
    expect(
      clientIp({
        socket: { remoteAddress: "127.0.0.1" } as never,
        headers: { "x-forwarded-for": "203.0.113.9" },
      }),
    ).toBe("127.0.0.1");
  });

  it("uses X-Real-IP only when the process trusts the proxy", () => {
    const request = {
      socket: { remoteAddress: "10.0.0.2" } as never,
      headers: { "x-real-ip": "203.0.113.10", "x-forwarded-for": "198.51.100.2" },
    };
    expect(clientIp(request, false)).toBe("10.0.0.2");
    expect(clientIp(request, true)).toBe("203.0.113.10");
    expect(
      clientIp(
        {
          socket: { remoteAddress: "10.0.0.2" } as never,
          headers: { "x-real-ip": "203.0.113.10, 198.51.100.2" },
        },
        true,
      ),
    ).toBe("10.0.0.2");
  });

  describe("http", () => {
    let server: Awaited<ReturnType<typeof NestFactory.create>>;

    beforeAll(async () => {
      server = await NestFactory.create(LimitedModule, { logger: false });
      server.use(requestIdMiddleware);
      await server.init();
    });

    afterAll(async () => {
      await server.close();
    });

    it("returns a generic 429 after the limit and does not reset on a forged forwarded IP", async () => {
      const agent = request(server.getHttpServer());
      expect((await agent.get("/limited")).status).toBe(200);
      expect((await agent.get("/limited")).status).toBe(200);
      const blocked = await agent.get("/limited").set("x-forwarded-for", "203.0.113.9");
      expect(blocked.status).toBe(429);
      expect(blocked.headers["retry-after"]).toBe("60");
      expect(blocked.body.error.code).toBe("rate_limited");
      expect(blocked.body.error.message).toBe("Too many requests");
      expect(JSON.stringify(blocked.body)).not.toMatch(/127\.0\.0\.1|203\.0\.113\.9|password|token/i);
    });
  });
});
