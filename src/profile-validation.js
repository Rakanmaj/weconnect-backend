import { z } from 'zod';

export const CAREER_PATHS = ['Frontend Developer', 'Backend Developer', 'Full-Stack Developer'];
const text = max => z.string().trim().max(max);
const required = max => text(max).min(1, 'Complete all required fields.');
const url = z.union([z.literal(''), text(2048).url().refine(value => /^https?:\/\//i.test(value), 'Use an http or https URL.')]);
export const emailSchema = z.object({ email: z.string().trim().toLowerCase().max(254).email('Enter a valid email address.') });
export const tokenSchema = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/, 'This link is invalid or expired.') });
export const resetSchema = tokenSchema.extend({ password: z.string().min(8).max(128), confirmPassword: z.string() })
  .refine(data => data.password === data.confirmPassword, { message: 'Passwords do not match.', path: ['confirmPassword'] });
export const developerSchema = z.object({
  firstName: required(100), lastName: required(100), location: required(200),
  preferredPosition: z.enum(['', ...CAREER_PATHS]), bio: text(5000), phone: text(40),
  education: z.array(z.object({ degree: required(200), institution: required(200), graduationYear: z.number().int().min(1950).max(2100), coursework: text(3000) })).max(10),
  skills: z.array(required(80)).max(30).transform(values => [...new Set(values)]),
  yearsExperience: z.number().int().min(0).max(60), careerGoals: text(3000), github: url, linkedin: url, portfolio: url,
  weeklyHours: z.number().int().min(1).max(80), projectTypes: z.array(z.enum(['Paid Project', 'Training Project', 'Hiring Challenge'])).max(3),
  availableFrom: z.union([z.literal(''), z.iso.date()]), onboardingStep: z.number().int().min(1).max(9),
});
export const companySchema = z.object({
  name: required(200), website: url.refine(Boolean, 'Enter your company website.'), industry: required(120),
  size: z.enum(['1-10', '11-50', '50-200', '200-500', '500+']), location: required(200),
  contactName: required(100), contactTitle: required(120), about: text(5000),
  registrationNumber: text(100), registrationCountry: text(100),
});
export const careerSchema = z.object({ careerPath: z.enum(CAREER_PATHS) });
export const reviewSchema = z.object({ status: z.enum(['verified', 'more-info', 'rejected']), feedback: text(5000), revision: z.number().int().min(0) })
  .refine(data => data.status === 'verified' || data.feedback.length >= 5, { message: 'Explain the reason or the information needed (at least 5 characters).', path: ['feedback'] });
export const teamSchema = emailSchema.extend({ name: required(100), password: z.string().min(8, 'Use a password with at least 8 characters.').max(128), role: z.enum(['Admin', 'Evaluator', 'Recruiter']) });
