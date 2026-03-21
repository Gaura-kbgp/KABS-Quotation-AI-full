# **App Name**: KABS Quotation AI

## Core Features:

- Secure Admin Authentication: User login, session management using cookies, server-side validation, and middleware protection for all '/admin' routes, integrated with Supabase authentication.
- Public Facing Pages: A homepage with navigation to the 'Quotation AI' start page and 'Design AI' coming soon page. Includes placeholder content for AI features.
- Admin Dashboard & Navigation: A dedicated admin area featuring a left sidebar navigation for managing system data, alongside a main content display area.
- Manufacturer CRUD Management: Admin interface for listing, adding, editing, and deleting manufacturers, including search and pagination, with data stored in Supabase.
- Manufacturer Document Uploads: Upload functionality for specification books (PDF) and pricing sheets (XLSX, XLSM, CSV, Google Sheet URL) for each manufacturer to Supabase Storage, with metadata stored in the database.
- NKBA Rules Document Management: Admin tools to upload, replace, and delete the NKBA Rules PDF document, with files stored in Supabase Storage and metadata in the database.
- Supabase Infrastructure Setup: Initialization of Supabase tables (manufacturers, manufacturer_files, nkba_files), implementation of Row Level Security (RLS), and configuration of Supabase Storage buckets with validation rules.

## Style Guidelines:

- Main application background: A deep, dark blue-gray, `#0f172a`, providing a sleek, premium, and focused environment.
- Primary interactive color: A vibrant Sky Blue, `#05ACFE`, for calls to action, highlights, and primary visual interest, enhancing the modern, techy feel on the dark background.
- Text color: A light, subtle off-white `#E2E8F0` (representing Tailwind's slate-200), ensuring excellent readability and contrast on dark backgrounds.
- Secondary background color: A slightly darker, heavily desaturated grey-blue, `#191E1F`, derived from the primary hue, used for differentiating content sections and 'glassmorphism' cards, maintaining theme consistency.
- Accent color: A complementary, brighter cyan-teal, `#60DBDB`, used sparingly for secondary highlights, subtle indicators, or notifications.
- Primary and secondary text: 'Inter' sans-serif for headlines and body, ensuring a clean, modern, objective, and highly legible SaaS aesthetic.
- Icons: Clean, minimalist line-art style icons that complement the premium and tech-oriented brand, utilizing text colors or the primary sky blue for interactive states.
- Overall design: Responsive layouts adapting to various screen sizes. Homepage employs a centered vertical layout for impactful presentation. Admin Dashboard features a distinct left sidebar navigation for structured content management.
- UI Components: Cards utilize a 'glassmorphism' effect with frosted transparency and subtle borders for a refined, premium feel. Buttons are rounded-xl with a gradient from `#38BDF8` (sky-400) to `#0284C7` (sky-600).
- Interactions: Subtle and smooth transitions across the application, dynamic hover effects on buttons featuring scaling and a soft glow, and elegant skeleton loaders to enhance user experience during data fetching.