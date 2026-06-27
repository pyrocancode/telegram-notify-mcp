import { Module } from "@nestjs/common";
import { CursorService } from "./cursor/cursor.service";
import { HealthController } from "./health.controller";
import { McpController } from "./mcp/mcp.controller";
import { TelegramController } from "./telegram/telegram.controller";
import { TelegramService } from "./telegram/telegram.service";

@Module({
  controllers: [HealthController, McpController, TelegramController],
  providers: [TelegramService, CursorService],
})
export class AppModule {}
