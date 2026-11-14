import { z } from "zod";

const email = z.string().trim().toLowerCase().max(254).email("Enter a valid email address.");
const password = z.string().min(8, "Use a password with at least 8 characters.").max(128, "Use no more than 128 characters.");
const requiredText = max => z.string().trim().min(1, "This field is required.").max(max);
const webUrl = z.string().trim().max(2048).url("Enter a valid website URL.").refine(value => {
  try { return ["http:", "https:"].includes(new URL(value).protocol); }
  catch { return false; }
}, "Use an http or https URL.");
const shared = { email, password, confirmPassword: z.string() };

export const registrationSchema = z.discriminatedUnion("role", [
  z.object({
    ...shared,
    role: z.literal("developer"),
    firstName: requiredText(100),
    lastName: requiredText(100),
    preferredRole: z.enum(["", "Frontend Developer", "Backend Developer", "Full-Stack Developer"]).default(""),
    location: requiredText(200),
    github: z.union([z.literal(""), webUrl]).default(""),
  }),
  z.object({
    ...shared,
    role: z.literal("company"),
    companyName: requiredText(200),
    website: webUrl,
    industry: requiredText(120),
    size: z.enum(["1-10", "11-50", "50-200", "200-500", "500+"]),
    location: requiredText(200),
    contactName: requiredText(100),
    contactTitle: requiredText(120),
    about: z.string().trim().max(5000).default(""),
  }),
]).refine(data => data.password === data.confirmPassword, {
  message: "Passwords do not match.", path: ["confirmPassword"],
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "Enter your password.").max(128),
  role: z.enum(["developer", "company", "admin"]).optional(),
});
