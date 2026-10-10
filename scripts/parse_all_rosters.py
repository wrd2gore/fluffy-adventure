import sys
import re
import json
import xlrd

sys.stdout.reconfigure(encoding='utf-8')

grade11_path = r'C:\Users\lynxb\.gemini\antigravity\brain\ab545925-307e-4215-a792-5b553bae3572\.user_uploaded\media_1791637557845_a351b50c.xls'
grade12_path = r'C:\Users\lynxb\.gemini\antigravity\brain\ab545925-307e-4215-a792-5b553bae3572\.user_uploaded\media_1791637557845_84cdd64c.xls'
grade10_path = r'C:\Users\lynxb\.gemini\antigravity\brain\ab545925-307e-4215-a792-5b553bae3572\.user_uploaded\media_1791637557845_c293a94d.xls'

def clean_text(s):
    if not isinstance(s, str):
        s = str(s)
    # Remove control characters and multiple spaces
    s = re.sub(r'[\u200e\u200f\u202a-\u202e]', '', s)
    s = re.sub(r'\s+', ' ', s).strip()
    return s

def parse_grade11():
    book = xlrd.open_workbook(grade11_path)
    sheet = book.sheet_by_name('قوائم')
    classes = {}
    current_class = None
    
    for r in range(sheet.nrows):
        row = [clean_text(sheet.cell_value(r, c)) for c in range(sheet.ncols)]
        text_joined = " ".join([c for c in row if c])
        
        # Check if header line defines class
        m = re.search(r'(حادي\s+عشر\s*/\s*\d+)', text_joined)
        if m:
            current_class = m.group(1).replace(' ', '')
            current_class = current_class.replace('حادي', 'حادي ').replace('عشر/', 'عشر / ')
            if current_class not in classes:
                classes[current_class] = []
            continue
            
        # Check if student row: col 1 is number, col 2 is name
        # Row format: ['', '1.0', 'ابراهيم بن سامي...', ...]
        num_col = None
        name_col = None
        for i, val in enumerate(row):
            if re.match(r'^\d+(\.0)?$', val) and i + 1 < len(row) and len(row[i+1]) > 3:
                num_col = i
                name_col = i + 1
                break
                
        if num_col is not None and current_class:
            num = str(int(float(row[num_col])))
            name = clean_text(row[name_col])
            # skip header keywords
            if name not in ['الاسم', 'الاســــــــــــــــــــــم', 'ملاحظات'] and not name.startswith('حادي'):
                classes[current_class].append({'num': num, 'name': name})
                
    return classes

def parse_grade12():
    book = xlrd.open_workbook(grade12_path)
    sheet = book.sheet_by_index(0) # Sheet1
    classes = {}
    current_class = None
    
    for r in range(sheet.nrows):
        row = [clean_text(sheet.cell_value(r, c)) for c in range(sheet.ncols)]
        text_joined = " ".join([c for c in row if c])
        
        m = re.search(r'(ثاني\s+عشر\s*/\s*\d+)', text_joined)
        if m:
            current_class = m.group(1).replace(' ', '')
            current_class = current_class.replace('ثاني', 'ثاني ').replace('عشر/', 'عشر / ')
            if current_class not in classes:
                classes[current_class] = []
            continue
            
        num_col = None
        name_col = None
        for i, val in enumerate(row):
            if re.match(r'^\d+(\.0)?$', val) and i + 1 < len(row) and len(row[i+1]) > 3:
                num_col = i
                name_col = i + 1
                break
                
        if num_col is not None and current_class:
            num = str(int(float(row[num_col])))
            name = clean_text(row[name_col])
            if name not in ['الاسم', 'الاســــــــــــــــــــــم', 'ملاحظات'] and not name.startswith('ثاني'):
                classes[current_class].append({'num': num, 'name': name})
                
    return classes

def parse_grade10():
    book = xlrd.open_workbook(grade10_path)
    sheet = book.sheet_by_name('الفصول')
    classes = {}
    current_class = None
    
    for r in range(sheet.nrows):
        row = [clean_text(sheet.cell_value(r, c)) for c in range(sheet.ncols)]
        text_joined = " ".join([c for c in row if c])
        
        m = re.search(r'(عاشر\s*/\s*\d+|\d+\s*/\s*عاشر)', text_joined)
        if m:
            matched = m.group(1).replace(' ', '')
            if matched.startswith('عاشر'):
                num = matched.split('/')[-1]
            else:
                num = matched.split('/')[0]
            current_class = f"عاشر / {num}"
            if current_class not in classes:
                classes[current_class] = []
            continue
            
        num_col = None
        name_col = None
        for i, val in enumerate(row):
            if re.match(r'^\d+(\.0)?$', val) and i + 1 < len(row) and len(row[i+1]) > 3:
                num_col = i
                name_col = i + 1
                break
                
        if num_col is not None and current_class:
            num = str(int(float(row[num_col])))
            name = clean_text(row[name_col])
            if name not in ['الاسم', 'الاســــــــــــــــــــــم', 'ملاحظات'] and 'عاشر' not in name:
                classes[current_class].append({'num': num, 'name': name})
                
    return classes

g11 = parse_grade11()
g12 = parse_grade12()
g10 = parse_grade10()

all_classes = {}
all_classes.update(g10)
all_classes.update(g11)
all_classes.update(g12)

total_students = 0
for cname, students in all_classes.items():
    print(f"Class '{cname}': {len(students)} students")
    total_students += len(students)

print(f"\nTotal classes: {len(all_classes)}")
print(f"Total students across all classes: {total_students}")

with open('scripts/all_students.json', 'w', encoding='utf-8') as f:
    json.dump(all_classes, f, ensure_ascii=False, indent=2)
print("Saved to scripts/all_students.json")
