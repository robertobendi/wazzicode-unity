import { useClaudeStream } from "@/hooks/useClaudeStream";
import MessageList from "./MessageList";
import Composer from "./Composer";

/** The main chat surface. Wires the Claude event stream into the store. */
export default function ChatView() {
  useClaudeStream();

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <MessageList />
      <Composer />
    </div>
  );
}
