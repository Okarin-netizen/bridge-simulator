/** 橋の座標（m、y 上向き）と画面の座標（px、y 下向き）を変換する */
export class Camera {
  scale = 1;
  private offsetX = 0;
  private offsetY = 0;

  /** 指定した範囲が画面にちょうど収まるように合わせる */
  fit(
    world: { minX: number; maxX: number; minY: number; maxY: number },
    screen: { width: number; height: number },
  ): void {
    const worldWidth = world.maxX - world.minX;
    const worldHeight = world.maxY - world.minY;
    this.scale = Math.min(screen.width / worldWidth, screen.height / worldHeight);
    this.offsetX = (screen.width - worldWidth * this.scale) / 2 - world.minX * this.scale;
    this.offsetY = (screen.height - worldHeight * this.scale) / 2 + world.maxY * this.scale;
  }

  toScreen(x: number, y: number): { x: number; y: number } {
    return { x: x * this.scale + this.offsetX, y: this.offsetY - y * this.scale };
  }

  toWorld(x: number, y: number): { x: number; y: number } {
    return { x: (x - this.offsetX) / this.scale, y: (this.offsetY - y) / this.scale };
  }
}
