import ts from '../../app/node_modules/typescript/lib/typescript.js'

/** Read only the factory's direct returned object; nested helpers are not BankApi methods. */
export function returnedApiMethods(source, factoryName) {
  const file = ts.createSourceFile('api.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  if (file.parseDiagnostics.length) throw new Error('API source contains TypeScript syntax errors')
  const factories = file.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === factoryName)
  if (factories.length !== 1) throw new Error(`Expected exactly one ${factoryName} factory`)
  const returns = factories[0].body?.statements.filter(ts.isReturnStatement) ?? []
  if (returns.length !== 1 || !returns[0].expression) throw new Error(`${factoryName} must directly return one API object`)
  // 工厂可以写成 `return api = { … }`：内部助手需要 `() => api` 这种自引用，
  // 必须先有变量再返回。这里只解一层赋值，不改「必须是对象字面量」这条约束 ——
  // spread、计算键、条件返回仍然一律拒绝，否则检查会退化成「随便返回什么都算过」。
  let expression = ts.isAssignmentExpression(returns[0].expression) ? returns[0].expression.right : returns[0].expression
  // The security wrapper preserves the exact API surface and checks mutations at call time.
  if (ts.isCallExpression(expression) && ts.isIdentifier(expression.expression) && expression.expression.text === 'protectAccountApi' && expression.arguments.length === 2) expression = expression.arguments[0]
  if (!ts.isObjectLiteralExpression(expression)) throw new Error(`${factoryName} must directly return one API object`)
  const names = new Set()
  for (const property of expression.properties) {
    if (ts.isSpreadAssignment(property) || !property.name || !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) throw new Error('Unsupported API property; inspect the contract checker before changing the factory shape')
    const name = property.name.text
    if (names.has(name)) throw new Error(`Duplicate API method: ${name}`)
    names.add(name)
  }
  return names
}
