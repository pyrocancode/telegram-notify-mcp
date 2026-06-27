import { NestFactory } from "@nestjs/core";
import { json, type NextFunction, type Request, type Response } from "express";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ["error", "warn"],
    bodyParser: false,
  });

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path === "/api/mcp") return next();
    return json({ limit: "1mb" })(req, res, next);
  });

  await app.listen(process.env.PORT ?? 3000);
}

bootstrap();
