import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Response } from "express";
import { z } from "zod";
import { CONFIG, type Config } from "../config";
import { ValidationError } from "../common/errors";
import { AUTH_RATE_LIMIT, IpThrottlerGuard, RATE_LIMIT_WINDOW_MS } from "../common/rate-limit";
import { SESSION_COOKIE_NAME } from "./auth.constants";
import { AuthGuard, type AuthedRequest } from "./auth.guard";
import { AuthService } from "./auth.service";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

function parseCredentials(body: unknown) {
  const parsed = credentialsSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError("Invalid request", parsed.error.flatten());
  }
  return parsed.data;
}

@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  private setSessionCookie(response: Response, rawToken: string, expiresAt: Date) {
    response.cookie(SESSION_COOKIE_NAME, rawToken, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: this.config.cookieSecure,
      expires: expiresAt,
    });
  }

  private clearSessionCookie(response: Response) {
    response.clearCookie(SESSION_COOKIE_NAME, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: this.config.cookieSecure,
    });
  }

  @Post("register")
  @UseGuards(IpThrottlerGuard)
  @Throttle({ default: { limit: AUTH_RATE_LIMIT, ttl: RATE_LIMIT_WINDOW_MS } })
  async register(@Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    const { email, password } = parseCredentials(body);
    const { user, session } = await this.auth.register(email, password);
    this.setSessionCookie(response, session.rawToken, session.expiresAt);
    response.status(201);
    return { user };
  }

  @Post("login")
  @HttpCode(200)
  @UseGuards(IpThrottlerGuard)
  @Throttle({ default: { limit: AUTH_RATE_LIMIT, ttl: RATE_LIMIT_WINDOW_MS } })
  async login(@Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    const { email, password } = parseCredentials(body);
    const { user, session } = await this.auth.login(email, password);
    this.setSessionCookie(response, session.rawToken, session.expiresAt);
    return { user };
  }

  @Get("me")
  @UseGuards(AuthGuard)
  me(@Req() request: AuthedRequest) {
    return { user: request.currentUser };
  }

  @Post("logout")
  @UseGuards(AuthGuard)
  @HttpCode(204)
  async logout(@Req() request: AuthedRequest, @Res({ passthrough: true }) response: Response) {
    if (request.currentSessionId) {
      await this.auth.revokeSession(request.currentSessionId);
    }
    this.clearSessionCookie(response);
  }
}
