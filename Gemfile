source "https://rubygems.org"

# GitHub Pagesの厳密なバージョン縛りを解除し、ローカル環境に合わせて最新化
gem "jekyll"
gem "webrick"
gem "csv"
gem "bigdecimal"

group :jekyll_plugins do
  gem "jekyll-feed"
  gem "jekyll-sitemap"
end

# Windows環境用（エラーの原因になったwdmは除外）
platforms :mingw, :x64_mingw, :mswin, :jruby, :windows do
  gem "tzinfo", ">= 1", "< 3"
  gem "tzinfo-data"
end