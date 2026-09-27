import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Response } from "express";
import { ThrottlerException } from "@nestjs/throttler";
import { MulterError } from "multer";
import { AppError } from "./errors";
import type { RequestWithId } from "./request-id";

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<RequestWithId>();
    const requestId = request.requestId ?? response.getHeader("x-request-id") ?? "";

    if (exception instanceof AppError) {
      return this.send(response, exception.statusCode, exception.code, exception.message, requestId, exception.details);
    }

    if (exception instanceof ThrottlerException) {
      response.setHeader("Retry-After", "60");
      return this.send(response, 429, "rate_limited", "Too many requests", requestId);
    }

    if (exception instanceof MulterError) {
      if (exception.code === "LIMIT_FILE_SIZE") {
        return this.send(response, 413, "payload_too_large", "File is larger than 25 MiB", requestId);
      }
      return this.send(response, 400, "validation_error", "Invalid upload", requestId);
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      if (status === HttpStatus.PAYLOAD_TOO_LARGE) {
        return this.send(response, 413, "payload_too_large", "File is larger than 25 MiB", requestId);
      }
      const message =
        typeof payload === "string"
          ? payload
          : status === HttpStatus.NOT_FOUND
            ? "Not found"
            : "Invalid request";
      const code = status === HttpStatus.NOT_FOUND ? "not_found" : "validation_error";
      return this.send(response, status, code, message, requestId);
    }

    this.logger.error(exception instanceof Error ? exception.stack : exception);
    return this.send(response, 500, "internal_error", "Something went wrong", requestId);
  }

  private send(
    response: Response,
    statusCode: number,
    code: string,
    message: string,
    requestId: string | number | string[],
    details?: unknown,
  ) {
    const body: {
      error: { code: string; message: string; details?: unknown };
      requestId: string;
    } = {
      error: { code, message },
      requestId: String(requestId),
    };
    if (details !== undefined && process.env.NODE_ENV !== "production") {
      body.error.details = details;
    }
    response.status(statusCode).json(body);
  }
}
