# Gameplay clips go here

Screen-record on your phone (portrait), AirDrop the video into this folder,
then render with the GameplayClip template:

```sh
bunx remotion render GameplayClip out/harpoon-triple.mp4 \
  --props='{"clip":"my-recording.mp4","hook":"He had one HP left. Then the Harpoon.","durationSeconds":12,"startFrom":4}'
```

`startFrom`/`durationSeconds` trim inside the template, so you don't need to
edit the recording first. Files here are gitignored.
