import {
  desktopCommandGroups,
} from "@onmyagent/types/desktop-ipc-commands";

export function createDesktopCommandRouter(dispatchCommand) {
  const domainHandlers = new Map(
    Object.entries(desktopCommandGroups).map(([domain, commands]) => [
      domain,
      new Map(commands.map((command) => [
        command,
        (event, args) => dispatchCommand(event, command, ...args),
      ])),
    ]),
  );

  const commandHandlers = new Map();
  for (const handlers of domainHandlers.values()) {
    for (const [command, handler] of handlers) {
      if (commandHandlers.has(command)) {
        throw new Error(`Desktop command is registered more than once: ${command}`);
      }
      commandHandlers.set(command, handler);
    }
  }

  const routeDesktopCommand = async (event, command, ...args) => {
    const handler = commandHandlers.get(command);
    if (!handler) {
      throw new Error(`Electron desktop bridge method is not declared: ${command}`);
    }
    return handler(event, args);
  };

  return Object.assign(routeDesktopCommand, { domainHandlers });
}
