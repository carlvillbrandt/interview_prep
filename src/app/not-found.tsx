import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center px-6 py-24 text-center">
      <p className="text-xs font-medium tracking-[0.22em] text-fg-subtle uppercase">404</p>
      <h1 className="font-display mt-4 text-5xl text-fg">This room is empty</h1>
      <p className="mt-4 text-fg-muted">We couldn&apos;t find that page, firm or interview.</p>
      <Link href="/" className="mt-8 rounded-full border border-line-strong px-5 py-3 text-sm text-fg hover:bg-ink-800">
        Back to PrepRoom
      </Link>
    </main>
  );
}
