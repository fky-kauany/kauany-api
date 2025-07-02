import mongoose from "mongoose";
import z from "zod";
const envSchema = z.object({
  PORT: z
    .string()
    .optional()
    .default("3000")
    .transform((data) => parseInt(data)),
  DB_PORT: z
    .string()
    .optional()
    .default("5432")
    .transform((data) => parseInt(data)),
  DB_URL: z.string().min(1, "Database URL is required"),
  RIOT_API: z.string().min(1, "Riot API key is required"),
});

const env = envSchema.parse(process.env);

mongoose.connect(env.DB_URL).then(() => {
  console.log("Connected to DB");
});
