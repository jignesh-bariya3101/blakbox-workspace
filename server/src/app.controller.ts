import { Controller, Get } from "@nestjs/common";

@Controller()
export class AppController {
  @Get()
  version() {
    return { name: "blakbox", version: "1" };
  }
}
