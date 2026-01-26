import z from "zod";

const DEFAULT_PORT = 8000;

const envSchema = z.object({
  NODE_ENV: z.string().optional(),
  HOST: z.string().optional(),
  SQLITE_DB_FILE_PATH: z.string().default(":memory:"),
  PORT: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : DEFAULT_PORT)),
});

export const env = envSchema.parse(process.env);
