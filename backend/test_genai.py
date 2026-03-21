import google.generativeai as genai
print(f"genai version: {genai.__version__}")
if hasattr(genai, 'upload_file'):
    print("upload_file exists")
else:
    print("upload_file DOES NOT exist")
print(f"Available attributes: {[a for a in dir(genai) if not a.startswith('_')]}")
