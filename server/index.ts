import { createApp } from "./app.js";
const env = process.env;
const service = await createApp({
  database: env.DATABASE ?? "data/raazi.db",
  secret: env.SECRET_KEY ?? "",
  mode: (env.AUTH_MODE ?? "oidc") as "oidc" | "development",
  secure: env.COOKIE_SECURE !== "false",
  adminGroup: env.ADMIN_GROUP ?? "raazi-admins",
  encryptionKey: env.ENCRYPTION_KEY,
  vectorURL: env.VECTOR_DATABASE_URL,
  chatURL: env.CHAT_DATABASE_URL,
  discoveryURL: env.OIDC_DISCOVERY_URL,
  clientId: env.OIDC_CLIENT_ID,
  clientSecret: env.OIDC_CLIENT_SECRET,
  redirectURI: env.OIDC_REDIRECT_URI,
});
const server = service.app.listen(
  Number(env.PORT ?? 8080),
  env.HOST ?? "127.0.0.1",
  () =>
    console.log(
      "Raazi listening on http://" +
        (env.HOST ?? "127.0.0.1") +
        ":" +
        (env.PORT ?? 8080),
    ),
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () =>
    server.close(async () => {
      await service.close();
      process.exit(0);
    }),
  );
