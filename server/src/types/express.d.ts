declare namespace Express {
  interface Request {
    user: { email: string };
    ws: import('../workspace/registry.js').Workspace;
    account: { id: string; label: string; contractNumber: number };
  }
}
