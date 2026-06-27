import { Controller, Get } from "@nestjs/common";

@Controller()
export class HealthController {
  @Get("health")
  health() {
    return { ok: true };
  }

  @Get("api/health")
  apiHealth() {
    return { ok: true };
  }
}
