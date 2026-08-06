interface NameGreetingProps {
  name: string;
}

export function NameGreeting({ name }: NameGreetingProps) {
  return (
    <div className="inline-flex items-center gap-3 bg-gradient-to-r from-blue-500 to-violet-500 text-white rounded-2xl px-6 py-4 shadow-md">
      <span className="text-2xl">👋</span>
      <div>
        <p className="text-xs font-medium uppercase tracking-widest opacity-75">Hello there</p>
        <p className="text-xl font-bold">{name}</p>
      </div>
    </div>
  );
}
