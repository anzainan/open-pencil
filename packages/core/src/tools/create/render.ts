import { defineTool } from '#core/tools/schema'

export const render = defineTool({
  name: 'render',
  mutates: true,
  description:
    'Render JSX to design nodes. Supports inline SVG paths, including open stroked paths: <svg viewBox="0 0 24 24" size={24}><path d="M2 12 L22 12" stroke="#000" fill="none" /></svg>. Use replace_id to replace a placeholder while preserving its position. Single-root only: JSX must return one container element (wrap multiple children in one Frame), otherwise an error is thrown.',
  params: {
    replace_id: {
      type: 'string',
      description: 'Node ID to replace — new node takes its position in parent, old node is deleted'
    },
    parent_id: { type: 'string', description: 'Parent node ID to render into' },
    insert_index: {
      type: 'number',
      description: 'Position among siblings (0 = first child). Omit to append at end.'
    },
    x: { type: 'number', description: 'X position of the root node' },
    y: { type: 'number', description: 'Y position of the root node' },
    jsx: { type: 'string', description: 'JSX string to render', required: true }
  },
  execute: async (figma, args) => {
    const { renderJSX } = await import('#core/design-jsx/render.js')

    let parentId = args.parent_id ?? figma.currentPageId
    let replaceIndex = -1

    if (args.replace_id) {
      const target = figma.graph.getNode(args.replace_id)
      if (target?.parentId) {
        parentId = target.parentId
        const parent = figma.graph.getNode(parentId)
        if (parent) {
          replaceIndex = parent.childIds.indexOf(args.replace_id)
        }
      }
    }

    const results = await renderJSX(figma.graph, args.jsx, {
      parentId,
      x: args.x,
      y: args.y
    })

    // 设计圣经要求单根：多根 fragment 不再静默建到页面顶层，先清理已创建节点再抛错。
    if (results.length > 1) {
      for (const root of results) {
        figma.graph.deleteNode(root.id)
      }
      throw new Error(
        `render 只支持单根 JSX（设计圣经要求），当前有 ${results.length} 个根；如需多元素请用单个容器包起来（如 <div flex col> 内放多个子元素）`
      )
    }

    const result = results[0]

    if (args.replace_id && replaceIndex >= 0) {
      figma.graph.reorderChild(result.id, parentId, replaceIndex)
      figma.graph.deleteNode(args.replace_id)
    } else if (args.insert_index !== undefined) {
      figma.graph.reorderChild(result.id, parentId, args.insert_index)
    }

    return {
      id: result.id,
      name: result.name,
      type: result.type,
      children: result.childIds,
      ...(result.warnings ? { warnings: result.warnings } : {})
    }
  }
})
