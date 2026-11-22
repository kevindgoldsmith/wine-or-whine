"""Tiny deterministic RNG (splitmix64) whose whole state is one JSON-friendly int."""

MASK = (1 << 64) - 1


class Rng:
    def __init__(self, state: int):
        self.state = state & MASK

    def next64(self) -> int:
        self.state = (self.state + 0x9E3779B97F4A7C15) & MASK
        z = self.state
        z = ((z ^ (z >> 30)) * 0xBF58476D1CE4E5B9) & MASK
        z = ((z ^ (z >> 27)) * 0x94D049BB133111EB) & MASK
        return z ^ (z >> 31)

    def below(self, n: int) -> int:
        """Uniform integer in [0, n) using rejection sampling (no modulo bias)."""
        if n <= 0:
            raise ValueError("n must be positive")
        limit = (MASK + 1) - ((MASK + 1) % n)
        while True:
            x = self.next64()
            if x < limit:
                return x % n

    def shuffle(self, items: list) -> None:
        for i in range(len(items) - 1, 0, -1):
            j = self.below(i + 1)
            items[i], items[j] = items[j], items[i]
