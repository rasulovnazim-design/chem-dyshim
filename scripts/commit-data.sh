#!/usr/bin/env bash
# Коммитит data/ и отправляет в main. Запускается только внутри GitHub Actions.
set -u
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git add data/
if git diff --cached --quiet; then
  echo "Изменений в data/ нет"
  exit 0
fi
git commit -q -m "$1"
for attempt in 1 2 3 4 5; do
  if git pull -q --rebase origin main && git push -q origin HEAD:main; then
    echo "Отправлено в main"
    exit 0
  fi
  sleep $((attempt * 5))
done
echo "::error::Не удалось отправить данные в main"
exit 1
