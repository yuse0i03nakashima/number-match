# web/ の中身を gh-pages ブランチに push して GitHub Pages を更新する。
# 使い方: リポジトリのルートで  powershell -ExecutionPolicy Bypass -File tools/deploy.ps1
# (Actions を使う場合は tools/pages.yml を .github/workflows/ に移す。gh の認証に workflow スコープが必要)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
$status = git status --porcelain web
if ($status) { Write-Host "web/ に未コミットの変更があります。先にコミットしてください。"; exit 1 }
$sha = git subtree split --prefix web main
git push --force origin "${sha}:refs/heads/gh-pages"
Write-Host "pushed web/ ($sha) to gh-pages"
