export type LocalUser = {
  username: string;
  email: string;
  password: string;
};

const LOCAL_AUTH_SESSION_EMAIL_KEY = "onmyagent.localAuth.email";

const LOCAL_USERS: readonly LocalUser[] = [
  {
    username: "Demo User",
    email: "demo@onmyagent.local",
    password: "123456",
  },
  {
    username: "Developer",
    email: "developer@onmyagent.local",
    password: "123456",
  },
  {
    username: "Reviewer",
    email: "reviewer@onmyagent.local",
    password: "123456",
  },
  {
    username: "Test User",
    email: "test@onmyagent.local",
    password: "123456",
  },
];

function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}

export function readLocalAuthUser(): LocalUser | null {
  if (typeof window === "undefined") return null;
  const email = (
    window.localStorage.getItem(LOCAL_AUTH_SESSION_EMAIL_KEY) ?? ""
  )
    .trim()
    .toLowerCase();
  if (!email) return null;
  return (
    LOCAL_USERS.find((user) => user.email.trim().toLowerCase() === email) ??
    null
  );
}

export function writeLocalAuthUser(user: LocalUser) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LOCAL_AUTH_SESSION_EMAIL_KEY, user.email);
}

export function clearLocalAuthUser() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(LOCAL_AUTH_SESSION_EMAIL_KEY);
}

export async function signInLocalUser(input: {
  username: string;
  password: string;
}): Promise<LocalUser | null> {
  const username = normalizeUsername(input.username);
  return (
    LOCAL_USERS.find(
      (user) =>
        normalizeUsername(user.username) === username &&
        user.password === input.password,
    ) ?? null
  );
}
