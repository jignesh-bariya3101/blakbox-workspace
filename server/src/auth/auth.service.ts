import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { UnauthorizedError, ValidationError } from "../common/errors";
import { generateOpaqueToken, hashToken } from "../common/tokens";
import { PrismaService } from "../prisma/prisma.service";
import { normalizeEmail } from "../users/normalize";
import { hashPassword, verifyPassword } from "../users/password";
import { SESSION_TTL_MS } from "./auth.constants";

const REGISTER_FAILED = "Unable to create an account";
const LOGIN_FAILED = "Invalid email or password";

export type PublicUser = {
  id: string;
  email: string;
};

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  private toPublicUser(user: { id: string; email: string }): PublicUser {
    return { id: user.id, email: user.email };
  }

  async register(email: string, password: string) {
    const normalized = normalizeEmail(email);
    const passwordHash = await hashPassword(password);

    try {
      const user = await this.prisma.user.create({
        data: { email: normalized, passwordHash },
      });
      const session = await this.createSession(user.id);
      return { user: this.toPublicUser(user), session };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ValidationError(REGISTER_FAILED);
      }
      throw error;
    }
  }

  async login(email: string, password: string) {
    const normalized = normalizeEmail(email);
    const user = await this.prisma.user.findUnique({ where: { email: normalized } });
    if (!user) {
      throw new UnauthorizedError(LOGIN_FAILED);
    }

    const matches = await verifyPassword(user.passwordHash, password);
    if (!matches) {
      throw new UnauthorizedError(LOGIN_FAILED);
    }

    const session = await this.createSession(user.id);
    return { user: this.toPublicUser(user), session };
  }

  async createSession(userId: string) {
    const rawToken = generateOpaqueToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    const record = await this.prisma.session.create({
      data: {
        userId,
        tokenHash: hashToken(rawToken),
        expiresAt,
      },
    });
    return { id: record.id, rawToken, expiresAt };
  }

  async authenticateSession(rawToken: string) {
    const record = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(rawToken) },
      include: { user: { select: { id: true, email: true } } },
    });

    if (!record || record.revokedAt || record.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedError("Authentication required");
    }

    return {
      sessionId: record.id,
      user: this.toPublicUser(record.user),
    };
  }

  async revokeSession(sessionId: string) {
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    });
  }
}
