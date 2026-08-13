import { autoDepth, describeOneNode } from '#core/tools/describe/tree'

import type { RPCCommand } from './types'

export interface DescribeArgs {
  id?: string
  ids?: string[]
  page?: string
  depth?: number
  grid?: number
}

const MAX_DESCRIBE_DEPTH = 5

/**
 * Shared pure-core describe report used by the CLI describe command and the
 * app automation RPC handler. Uses the exact same implementation as the MCP
 * `describe` tool, so headless and browser-backed reports always agree.
 */
export const describeCommand: RPCCommand<DescribeArgs> = {
  name: 'describe',
  execute: (graph, args) => {
    const gridSize = args.grid ?? 8
    const describeId = (nodeId: string) =>
      describeOneNode(
        { graph },
        nodeId,
        Math.min(args.depth ?? autoDepth(graph, nodeId), MAX_DESCRIBE_DEPTH),
        gridSize
      )

    let ids: string[] | undefined
    if (args.ids && args.ids.length > 0) ids = args.ids
    else if (args.id) ids = [args.id]
    if (ids) {
      return { nodes: ids.map(describeId) }
    }

    const pages = graph.getPages()
    const page = args.page ? pages.find((p) => p.name === args.page) : pages[0]
    if (!page) {
      return {
        error: `Page "${args.page ?? ''}" not found. Available: ${pages.map((p) => p.name).join(', ') || 'none'}`
      }
    }
    return { page: { id: page.id, name: page.name }, nodes: page.childIds.map(describeId) }
  }
}
