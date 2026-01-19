import z from "zod";

const envSchema = z.object({
  NODE_ENV: z.string().optional(),
  HOST: z.string().optional(),
  PORT: z
    .string()
    .transform((val) => parseInt(val))
    .optional(),
});

export const env = envSchema.parse(process.env);
