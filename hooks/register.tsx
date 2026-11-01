import type { Register } from 'claude-code'

const RTL = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/

export const register: Register = on => {
  on('ui.render', { component: 'AssistantMessage' }, ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.isSummary || !RTL.test(e.props.text)) {
      return next(e)
    }
    const { Box, Text, Client } = $.ui.resolve(e)

    return (
      <Box flexDirection="row" width="100%">
        <Text>{e.props.isFirstOfReply ? '● ' : '  '}</Text>
        <Client key="rtl" module="./rtl.tsx" props={{ text: e.props.text }} flexGrow={1} />
      </Box>
    )
  })

  // The person's own typed prompts; notifications and other senders keep the
  // engine's row.
  on('ui.render', { component: 'UserMessage' }, ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.origin.kind !== 'composer' || !RTL.test(e.props.text)) {
      return next(e)
    }
    const { Box, Text, Client } = $.ui.resolve(e)

    return (
      <Box flexDirection="row" width="100%">
        <Text dimColor>{'❯ '}</Text>
        <Client key="rtl" module="./rtl.tsx" props={{ text: e.props.text, plain: true }} flexGrow={1} />
      </Box>
    )
  })
}
