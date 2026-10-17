import "server-only";

/**
 * Loads every automation that registers workflow step handlers. Import this
 * (for its side effects) anywhere runs are executed: the hub cron, webhook
 * and form routes, and the "retry" action.
 */
import "@/services/form-service";
import "@/services/reminder-service";
import "@/services/crosspost-service";
