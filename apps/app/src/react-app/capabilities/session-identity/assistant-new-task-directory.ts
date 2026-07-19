/**
 * Pending project directory for the next assistant "+ new task" navigation.
 * Space-folder “new chat” queues a directory; create-task consumes it so the
 * draft composer binds to that space without expanding SessionPage props.
 */
let pendingDirectory: string | null = null;

export function queueAssistantNewTaskDirectory(directory: string | null) {
  const value = directory?.trim() || "";
  pendingDirectory = value || null;
}

export function takeAssistantNewTaskDirectory(): string | null {
  const value = pendingDirectory;
  pendingDirectory = null;
  return value;
}

export function peekAssistantNewTaskDirectory(): string | null {
  return pendingDirectory;
}
