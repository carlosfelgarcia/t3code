import { Button } from "../ui/button";
import { type ContextWindowSnapshot, formatContextWindowTokens } from "~/lib/contextWindow";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import {
  contextBudget,
  formatContextWindowCompactionMessage,
  formatContextWindowCost,
} from "./ContextWindowMeter.logic";
import { Minimize2Icon } from "lucide-react";
import { cn } from "~/lib/utils";
import { composerFloatingLayerProps } from "./composerEventScope";

function formatPercentage(value: number): string {
  if (value < 10) {
    return `${value.toFixed(1).replace(/\.0$/, "")}%`;
  }
  return `${Math.round(value)}%`;
}

const TONE_TEXT_CLASS = {
  success: "text-success-foreground",
  warning: "text-warning-foreground",
  error: "text-error-foreground",
} as const;

const TONE_BAR_CLASS = {
  success: "bg-success",
  warning: "bg-warning",
  error: "bg-error",
} as const;

export function ContextWindowMeter(props: {
  usage: ContextWindowSnapshot;
  modelDisplayName?: string | null;
  condensed?: boolean | undefined;
  onCompact?: (() => void) | undefined;
  compactDisabled?: boolean | undefined;
  compactDisabledReason?: string | null | undefined;
}) {
  const { usage, modelDisplayName, condensed, onCompact, compactDisabled, compactDisabledReason } =
    props;
  const budget = contextBudget({
    usedTokens: usage.usedTokens,
    maxTokens: usage.maxTokens ?? null,
  });
  const usedPercentage = formatPercentage(budget.usedPercentage);
  const usedOfBudget = `${formatContextWindowTokens(usage.usedTokens)}/${formatContextWindowTokens(budget.budgetTokens)}`;
  const totalProcessedTokens = usage.totalProcessedTokens ?? null;
  const showTotalProcessed = totalProcessedTokens !== null && totalProcessedTokens > 0;

  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={150}
        closeDelay={onCompact ? 150 : 0}
        render={
          <Button
            size="xs"
            variant="ghost-muted"
            aria-label={`Context budget ${usedPercentage} used`}
          >
            <span className={cn("tabular-nums", TONE_TEXT_CLASS[budget.tone])}>
              {condensed ? usedPercentage : `${usedOfBudget} (${usedPercentage})`}
            </span>
          </Button>
        }
      />
      <PopoverPopup
        {...composerFloatingLayerProps}
        tooltipStyle
        side="top"
        align="end"
        padding="none"
        width="sm"
        className="text-left whitespace-normal"
      >
        <div className="flex flex-col gap-2 p-(--floating-content-inset)">
          <div className="flex items-center justify-between gap-3">
            <div className="font-medium text-muted-foreground text-xs">Context budget</div>
            <div className="text-secondary-label text-2xs tabular-nums">
              <span>{usedPercentage}</span>
              <span className="mx-1">·</span>
              <span>{usedOfBudget}</span>
            </div>
          </div>
          <div
            className="h-1.5 w-full overflow-hidden rounded-full bg-muted/60"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(budget.usedPercentage)}
            aria-label="Context budget usage"
          >
            <div
              className={cn(
                "h-full rounded-full transition-[width,background-color] duration-500 ease-out motion-reduce:transition-none",
                TONE_BAR_CLASS[budget.tone],
              )}
              style={{ width: `${budget.usedPercentage}%` }}
            />
          </div>
          {budget.modelWindowTokens !== null ? (
            <div className="flex items-center justify-between gap-3 text-2xs leading-4">
              <span className="text-secondary-label">Model window</span>
              <span className="font-medium tabular-nums text-secondary-label">
                {formatContextWindowTokens(budget.modelWindowTokens)}
              </span>
            </div>
          ) : null}
          {showTotalProcessed ? (
            <div className="flex items-center justify-between gap-3 text-2xs leading-4">
              <span className="text-secondary-label">Total processed</span>
              <span className="font-medium tabular-nums text-secondary-label">
                {formatContextWindowTokens(totalProcessedTokens)}
              </span>
            </div>
          ) : null}
          {usage.cost != null ? (
            <div className="flex items-center justify-between gap-3 text-2xs leading-4">
              <span className="text-secondary-label">Cost</span>
              <span className="font-medium tabular-nums text-secondary-label">
                {formatContextWindowCost(usage.cost)}
              </span>
            </div>
          ) : null}
          {usage.compactsAutomatically ? (
            <div className="mt-1 text-pretty text-secondary-label text-2xs font-medium">
              {formatContextWindowCompactionMessage(modelDisplayName, usage.autoCompactThreshold)}
            </div>
          ) : null}
          {onCompact ? (
            <>
              <Button
                size="xs"
                variant="outline"
                className="mt-1 w-full justify-center"
                disabled={compactDisabled}
                onClick={onCompact}
              >
                <Minimize2Icon aria-hidden="true" />
                Compact context
              </Button>
              {compactDisabled && compactDisabledReason ? (
                <div className="text-pretty text-secondary-label text-2xs">
                  {compactDisabledReason}
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </PopoverPopup>
    </Popover>
  );
}

export function ContextWindowMeterPlaceholder(props: { condensed?: boolean | undefined }) {
  return (
    <Button size="xs" variant="ghost-muted" aria-hidden="true" tabIndex={-1} className="invisible">
      <span className="tabular-nums">{props.condensed ? "00%" : "000k/200k (00%)"}</span>
    </Button>
  );
}
