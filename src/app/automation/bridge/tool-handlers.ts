import type { FigmaAPI } from '@open-pencil/core/figma-api'

import { applyAutomationTool } from '@/app/automation/bridge/apply'
import type { AutomationTarget } from '@/app/automation/bridge/target'

type FigmaFactory = (store: AutomationTarget['store'], pageId?: string) => FigmaAPI

export function createAutomationToolHandler(makeFigma: FigmaFactory) {
  return async function handleTool(target: AutomationTarget, args: unknown): Promise<unknown> {
    const toolName = (args as { name?: string }).name
    const toolArgs = (args as { args?: Record<string, unknown> }).args ?? {}
    if (!toolName) throw new Error('Missing "name" in args')

    const result = await applyAutomationTool(makeFigma, target, toolName, toolArgs, {
      undo: true,
      journal: true
    })
    if (!result.ok) throw new Error(result.error ?? 'Tool failed')
    return { ok: true, result: result.result }
  }
}
