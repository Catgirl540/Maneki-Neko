# 已归档：网页改版前源码与设计

当前网页仍在根目录 `app/`，维护依据见 [CLIENTS.md](../../../CLIENTS.md)。

本目录保存：

- `source.tar.gz`：提交 `444944e5790468980249cb4080a0ece84d471d7f` 的 `app/` 与根 README，含改版前页面、样式、品牌及原维护说明。不含依赖、本机配置和构建产物。
- `brand/`：原 `design/brand/` 的金蓝风格规范与生成素材。
- `shots/`：原 `design/shots/` 的历史截图。
- `superseded-prototypes/`：已取消双模式的设计需求、请求与截图。
- `scripts/gen_images.py`：旧品牌生图脚本原文，仅供回溯；原相对路径已失效，不直接运行。

旧稿不再指导当前页面。源码快照可在临时目录中用 `tar -xzf source.tar.gz -C <临时目录>` 查看，不要解压覆盖当前工作区。

`source.tar.gz` 的 SHA-256 和字节数记录在 [manifest.json](../manifest.json)。此次保留当前 `app/` 的业务接口和共享组件，仅归档旧设计及其可追溯快照。
