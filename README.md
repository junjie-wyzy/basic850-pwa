# 词骨英语 850 PWA

这是一个个人自用的 Basic English 850 词学习 PWA。

## 运行

在本目录启动一个静态服务器：

```bash
python3 -m http.server 4173
```

然后打开：

```text
http://localhost:4173
```

## iPhone 使用

部署到 HTTPS 地址后，用 iPhone Safari 打开网页，再通过分享菜单添加到主屏幕。

## 数据

词库使用 `data/words.jsonl`，一行一个单词，不使用大型格式化 JSON。字段包括：

- `word`
- `category`
- `phonetic`
- `meaningZh`
- `example`
- `exampleZh`

音标和中文释义来自 ECDICT 的公开词典数据，例句来自本机已有的 `basic_words.json`，例句中文翻译由自动翻译生成，建议后续人工校对。
