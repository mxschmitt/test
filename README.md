# test

## Max.sh Screenshot Tool

This repository includes functionality to take screenshots of the max.sh website.

### Usage

To take a screenshot of https://max.sh:

```bash
node take_max_sh_screenshot.mjs
```

This will create a file `max_sh_screenshot.png` containing a full-page screenshot of the website.

### Testing

Run the screenshot tests with:

```bash
npx playwright test tests/max-sh-screenshot.spec.ts
```
