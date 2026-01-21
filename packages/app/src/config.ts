import z from "zod";

const DEFAULT_PORT = 8080;

const envSchema = z.object({
  NODE_ENV: z.string().optional(),
  HOST: z.string().optional(),
  SQLITE_DB_FILE_PATH: z.string(),
  PORT: z
    .string()
    .transform((val) => (Number.isInteger(val) ? parseInt(val) : DEFAULT_PORT))
    .optional(),
});

export const env = envSchema.parse(process.env);
