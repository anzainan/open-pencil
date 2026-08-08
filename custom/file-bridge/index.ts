import { startServer } from './server'

const port = Number(process.env.BRIDGE_PORT ?? '8080')
startServer({ port })
