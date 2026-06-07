import { Skeleton } from '../ui/skeleton';
import { cn } from '../../lib/utils';

/**
 * Placeholder shown while the chatroom auto-resumes its active session on
 * mount. Mirrors the single-agent chat's hydrating skeleton: avatar + name +
 * message lines in the real transcript's shape, so a resumed conversation
 * settles in place instead of popping in over the session picker.
 */
export function ChatroomHydratingSkeleton() {
  return (
    <div className="flex-1 overflow-y-auto px-4 py-4" aria-busy="true" data-testid="chatroom-hydrating-skeleton">
      <div className="max-w-3xl mx-auto space-y-6">
        {[2, 1, 3].map((lines, i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="w-10 h-10 rounded-full shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0 space-y-2">
              <div className="flex items-center gap-2">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-2.5 w-12" />
              </div>
              {Array.from({ length: lines }).map((_, line) => (
                <Skeleton key={line} className={cn('h-3', line === lines - 1 ? 'w-[60%]' : 'w-full')} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
