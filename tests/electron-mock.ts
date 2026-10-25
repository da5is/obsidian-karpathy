export const shell = {
  opened: [] as string[],
  error: "",
  async openPath(path: string): Promise<string> {
    this.opened.push(path);
    return this.error;
  }
};
