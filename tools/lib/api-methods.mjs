import ts from '../../app/node_modules/typescript/lib/typescript.js'

/** Read only the factory's direct returned object; nested helpers are not BankApi methods. */
export function returnedApiMethods(source, factoryName) {
  const file = ts.createSourceFile('api.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  if (file.parseDiagnostics.length) throw new Error('API source contains TypeScript syntax errors')
  const factories = file.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === factoryName)
  if (factories.length !== 1) throw new Error(`Expected exactly one ${factoryName} factory`)
  const returns = factories[0].body?.statements.filter(ts.isReturnStatement) ?? []
  if (returns.length !== 1 || !returns[0].expression || !ts.isObjectLiteralExpression(returns[0].expression)) throw new Error(`${factoryName} must directly return one API object`)
  const names = new Set()
  for (const property of returns[0].expression.properties) {
    if (ts.isSpreadAssignment(property) || !property.name || !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) throw new Error('Unsupported API property; inspect the contract checker before changing the factory shape')
    const name = property.name.text
    if (names.has(name)) throw new Error(`Duplicate API method: ${name}`)
    names.add(name)
  }
  return names
}
