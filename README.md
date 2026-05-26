# Fillo Career Glide

Fillo Career Glide is a Vite-powered React application that helps job seekers streamline repetitive application workflows. The web app pairs with a Chrome extension to mirror the authenticated state of the user and autofill enterprise job application forms such as Workday and iCIMS.

## Features

- ✨ **Landing experience** that introduces the product benefits and funnels users to authentication.
- 🔐 **Auth-aware extension integration** – the app broadcasts Supabase session updates to the browser extension.
- 📊 **Dashboard & profile management** surfaces – build tailored profiles the extension can reuse.
- 🧩 **Shadcn UI component system** styled with Tailwind CSS.

## Tech stack

- [Vite](https://vitejs.dev/) for the build toolchain and dev server
- [React 18](https://react.dev/) with TypeScript
- [Tailwind CSS](https://tailwindcss.com/) for utility-first styling
- [shadcn/ui](https://ui.shadcn.com/) component primitives
- [@tanstack/react-query](https://tanstack.com/query/latest) for data fetching
- [Supabase](https://supabase.com/) for authentication and persistence

## Getting started

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Run the development server**

   ```bash
   npm run dev
   ```

   The app starts on [http://localhost:5173](http://localhost:5173) by default.

3. **Lint the project**

   ```bash
   npm run lint
   ```

   The ESLint configuration targets modern React/TypeScript best practices.

## Project structure

```
src/
├── components/       # Reusable UI components (Landing page, shared UI primitives, etc.)
├── hooks/            # Custom React hooks including extension integration helpers
├── integrations/     # Supabase SDK wrappers and API helpers
├── pages/            # Route-level views
└── utils/            # Utility helpers such as name parsing
```

Outside of `src/` you'll find `extension/` (Chrome extension source) and `supabase/` (SQL migrations and scripts) that work alongside the application.

## Browser extension pairing

The `useFilloExtension` hook emits authentication changes to the Chrome extension via `window.postMessage`. Include the `<ExtensionIntegration />` helper component inside the authenticated area of the app so the extension stays in sync with user logins and logouts.

## Deployment

This project can be hosted on any static-friendly provider such as Netlify, Vercel, or Supabase Hosting. Build the production bundle with:

```bash
npm run build
```

Then deploy the contents of the generated `dist/` directory to your hosting provider of choice.
