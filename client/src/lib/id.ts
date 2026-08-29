const ALPHABET =
  'ModuleSymbhasOwnPr0perty1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'

/** Small dependency-free id generator, good enough for room ids / passwords. */
export function nanoid(size = 10): string {
  let id = ''
  const bytes = new Uint8Array(size)
  crypto.getRandomValues(bytes)
  for (let i = 0; i < size; i++) {
    id += ALPHABET[bytes[i] % ALPHABET.length]
  }
  return id
}

const NAME_ADJECTIVES = ['Swift', 'Calm', 'Bright', 'Bold', 'Quiet', 'Sharp', 'Lucky', 'Sunny']
const NAME_ANIMALS = ['Falcon', 'Otter', 'Panther', 'Sparrow', 'Fox', 'Wolf', 'Heron', 'Lynx']

export function randomDisplayName(): string {
  const a = NAME_ADJECTIVES[Math.floor(Math.random() * NAME_ADJECTIVES.length)]
  const b = NAME_ANIMALS[Math.floor(Math.random() * NAME_ANIMALS.length)]
  return `${a}${b}`
}

const CURSOR_COLORS = [
  '#f97316', '#22c55e', '#3b82f6', '#e11d48',
  '#a855f7', '#06b6d4', '#eab308', '#ec4899'
]

export function randomColor(): string {
  return CURSOR_COLORS[Math.floor(Math.random() * CURSOR_COLORS.length)]
}
