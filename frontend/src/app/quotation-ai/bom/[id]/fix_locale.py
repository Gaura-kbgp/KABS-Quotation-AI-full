
# Fix: Replace all toLocaleString(undefined, with toLocaleString('en-US', 
# This prevents SSR/client hydration mismatch caused by locale differences
# (server in India renders $1,99,182 while browser renders $199,182)

tfile = r'c:\KABS completed project files\KABS-Quotation-AI-full-main\frontend\src\app\quotation-ai\bom\[id]\bom-manager-client.tsx'

with open(tfile, 'r', encoding='utf-8') as f:
    content = f.read()

old = "toLocaleString(undefined,"
new = "toLocaleString('en-US',"

count = content.count(old)
content = content.replace(old, new)

with open(tfile, 'w', encoding='utf-8') as f:
    f.write(content)

print(f"SUCCESS: replaced {count} occurrences of toLocaleString(undefined, with toLocaleString('en-US',")
