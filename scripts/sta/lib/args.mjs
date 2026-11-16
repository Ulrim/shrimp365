// 명령행 인자 — `--이름 값` 과 `--이름=값`, 값 없는 스위치.
export function parseArgs(argv, spec) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i]
    if (!a.startsWith("--")) throw new Error(`알 수 없는 인자: ${a}`)
    let value
    const eq = a.indexOf("=")
    if (eq > 0) { value = a.slice(eq + 1); a = a.slice(0, eq) }
    const name = a.slice(2)
    if (!(name in spec)) throw new Error(`알 수 없는 옵션: --${name}\n쓸 수 있는 옵션: ${Object.keys(spec).map(k => "--" + k).join(" ")}`)
    if (spec[name] === "flag") { out[name] = true; continue }
    if (value === undefined) value = argv[++i]
    if (value === undefined) throw new Error(`--${name} 에 값이 없습니다`)
    out[name] = value
  }
  return out
}
