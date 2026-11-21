import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type AppLanguage = "en" | "ko";
export type AppTheme = "light" | "dark";
export type AppCurrency = "KRW" | "USD" | "MYR";
export type AppDisplaySize = "compact" | "default" | "large";
export type AppMode = "simple" | "advanced";

type ExchangeRates = Partial<Record<AppCurrency, number>>;
type ExchangeRateStatus = "loading" | "ready" | "error";

const LANGUAGE_KEY = "pointnull-language";
const THEME_KEY = "pointnull-theme";
const CURRENCY_KEY = "pointnull-currency";
const DISPLAY_SIZE_KEY = "pointnull-display-size";
const APP_MODE_KEY = "pointnull-app-mode";
const FX_CACHE_KEY = "pointnull-fx-rates";
const FX_CACHE_TTL = 12 * 60 * 60 * 1000;

const ko: Record<string, string> = {
  "Sales workspace": "판매 작업 공간",
  "Sell": "판매",
  "Analysis": "분석",
  "Marketing": "마케팅",
  "Customers": "고객",
  "Orders": "주문",
  "Import data": "데이터 가져오기",
  "Import": "가져오기",
  "Settings": "설정",
  "Language / 언어": "언어",
  "Appearance": "화면 테마",
  "Display size": "표시 크기",
  "App Mode": "앱 모드",
  "Simple Mode": "간편 모드",
  "Advanced Mode": "고급 모드",
  "Choose the workspace that fits your business needs.": "비즈니스 요구에 맞는 작업 공간을 선택하세요.",
  "Essential tools for daily sales.": "일상적인 판매에 필요한 필수 기능입니다.",
  "Full tools for growing businesses.": "성장하는 비즈니스를 위한 전체 기능입니다.",
  "Simple Mode includes selling, a basic customer directory, order history, and Import. Advanced Mode adds Analysis, Marketing, and full customer management.": "간편 모드에서는 판매, 기본 고객 목록, 주문 내역 및 데이터 가져오기를 사용할 수 있습니다. 고급 모드에서는 분석, 마케팅 및 전체 고객 관리 기능이 추가됩니다.",
  "Switching modes only changes which tools appear. Your existing data remains saved.": "모드를 변경해도 표시되는 기능만 달라지며 기존 데이터는 그대로 저장됩니다.",
  "Confirm the customer and complete the sale.": "고객을 확인하고 판매를 완료하세요.",
  "Simple": "간편",
  "Advanced": "고급",
  "Adjust spacing and text size.": "간격과 글자 크기를 조정하세요.",
  "Compact": "컴팩트",
  "Default": "기본",
  "Large": "크게",
  "More content": "더 많은 내용을 표시",
  "Balanced layout": "균형 잡힌 레이아웃",
  "Easier to read": "더 편하게 읽기",
  "Currency / 통화": "표시 통화",
  "Choose your preferred display currency.": "표시할 통화를 선택하세요.",
  "KRW · Korean Won": "KRW · 대한민국 원",
  "USD · US Dollar": "USD · 미국 달러",
  "MYR · Malaysian Ringgit": "MYR · 말레이시아 링깃",
  "Base currency": "기준 통화",
  "US Dollar": "미국 달러",
  "Malaysian Ringgit": "말레이시아 링깃",
  "Currency conversion is for display only. All transactions are recorded in KRW.": "통화 변환은 화면 표시용이며 모든 거래는 원화(KRW)로 기록됩니다.",
  "Loading exchange rates…": "환율을 불러오는 중…",
  "Reference rates updated": "참고 환율 업데이트:",
  "Exchange rates are unavailable. KRW remains selected.": "환율을 사용할 수 없습니다. KRW가 선택된 상태로 유지됩니다.",
  "Using saved exchange rates because the latest rates could not be loaded.": "최신 환율을 불러오지 못해 저장된 환율을 사용하고 있습니다.",
  "Choose your preferred language.": "사용할 언어를 선택하세요.",
  "Choose how PointNull looks.": "PointNull의 화면 테마를 선택하세요.",
  "Bright workspace": "밝은 화면",
  "Low-light workspace": "어두운 화면",
  "English": "English",
  "한국어": "한국어",
  "Light": "라이트 모드",
  "Dark": "다크 모드",
  "Your preferences are saved on this device.": "설정은 이 기기에 저장됩니다.",
  "Manage products": "상품 관리",
  "New sale": "새 판매",
  "Edit menu information and control product availability.": "메뉴 정보를 수정하고 상품 판매 여부를 관리하세요.",
  "Choose products for the current order.": "현재 주문에 추가할 상품을 선택하세요.",
  "total items": "개 상품",
  "available items": "개 판매 가능 상품",
  "All": "전체",
  "Done managing": "관리 완료",
  "Manage Products": "상품 관리",
  "Add product": "상품 추가",
  "No menu items to show": "표시할 메뉴가 없습니다",
  "Products from the connected database will appear here.": "연결된 데이터베이스의 상품이 여기에 표시됩니다.",
  "Uncategorized": "미분류",
  "Inactive": "비활성",
  "Not for sale": "판매 중지",
  "Available": "판매 가능",
  "Management mode": "관리 모드",
  "Tap to add": "눌러서 추가",
  "Edit": "수정",
  "Reactivate": "재활성화",
  "Deactivate": "비활성화",
  "Sell setup": "판매 설정",
  "Edit product": "상품 수정",
  "Product name": "상품명",
  "Category": "카테고리",
  "Choose a category": "카테고리를 선택하세요",
  "Price": "가격",
  "Product image": "상품 이미지",
  "optional": "선택 사항",
  "Cancel": "취소",
  "Save changes": "변경 사항 저장",
  "Saving…": "저장 중…",
  "Add customer": "고객 추가",
  "Customer name": "고객 이름",
  "Phone number": "전화번호",
  "Age": "나이",
  "Gender": "성별",
  "Not recorded": "미기록",
  "Woman": "여성",
  "Man": "남성",
  "Other": "기타",
  "Quick registration": "빠른 등록",
  "New customer": "신규 고객",
  "Only a name and phone number are required.": "이름과 전화번호만 입력하면 됩니다.",
  "Back to search": "검색으로 돌아가기",
  "Register & Select": "등록 후 선택",
  "Registering…": "등록 중…",
  "Complete transaction": "거래 완료",
  "Current order": "현재 주문",
  "Draft": "임시 주문",
  "No products added yet": "아직 추가된 상품이 없습니다.",
  "item": "개 상품",
  "items": "개 상품",
  "ready for checkout": "결제 준비 완료",
  "Order total": "주문 합계",
  "Complete Transaction": "거래 완료",
  "Checkout": "결제",
  "Confirm the customer, apply an optional campaign, and complete the sale.": "고객을 확인하고 선택적으로 캠페인을 적용한 뒤 판매를 완료하세요.",
  "Walk-in Customer": "현장 방문 고객",
  "Registered Customer": "등록 고객",
  "Campaign code": "캠페인 코드",
  "Optional. Eligibility is based on campaign rules and is available to walk-in customers when allowed.": "선택 사항입니다. 캠페인 규칙에 따라 현장 방문 고객도 사용할 수 있습니다.",
  "Applied": "적용됨",
  "Remove": "삭제",
  "Choose a running campaign code…": "진행 중인 캠페인 코드를 선택하세요…",
  "Or enter a code manually": "또는 코드를 직접 입력하세요",
  "Checking…": "확인 중…",
  "Apply": "적용",
  "Order summary": "주문 요약",
  "items in this transaction": "개 상품",
  "Subtotal": "소계",
  "Campaign": "캠페인",
  "None": "없음",
  "Discount": "할인",
  "Final total": "최종 결제 금액",
  "Processing transaction…": "거래 처리 중…",
  "Confirm Transaction": "거래 확인",
  "No customer information is required.": "고객 정보가 필요하지 않습니다.",
  "Select a customer to continue.": "계속하려면 고객을 선택하세요.",
  "Preparing your workspace": "작업 공간 준비 중",
  "SECURE DATA CONNECTION": "보안 데이터 연결",
  "Loading products...": "상품 불러오는 중...",
  "Manage customer records and review purchase history.": "고객 정보를 관리하고 구매 내역을 확인하세요.",
  "Search customers": "고객 검색",
  "No customers found": "고객을 찾을 수 없습니다",
  "Customer record": "고객 정보",
  "Edit customer": "고객 정보 수정",
  "Customer details": "고객 상세 정보",
  "Total Orders": "총 주문 수",
  "Total Spent": "총 지출액",
  "Last Order": "최근 주문",
  "Customer order history": "고객 주문 내역",
  "Marketing campaigns": "마케팅 캠페인",
  "Manage promotions and review their performance in Marketing analysis.": "프로모션을 관리하고 마케팅 분석에서 성과를 확인하세요.",
  "View campaign analytics ↗": "캠페인 분석 보기 ↗",
  "+ Add campaign": "+ 캠페인 추가",
  "Active": "진행 중",
  "Completed": "완료됨",
  "Create campaign": "캠페인 만들기",
  "Edit campaign": "캠페인 수정",
  "Campaign name": "캠페인 이름",
  "Promo code": "프로모션 코드",
  "Channel": "채널",
  "Start date": "시작일",
  "End date": "종료일",
  "Budget": "예산",
  "Discount value": "할인 금액",
  "Save campaign": "캠페인 저장",
  "View and manage your restaurant's sales transactions.": "매장의 판매 거래를 확인하고 관리하세요.",
  "Search orders": "주문 검색",
  "Order details": "주문 상세 정보",
  "Order items": "주문 상품",
  "Today": "오늘",
  "Last 7 days": "최근 7일",
  "Last 30 days": "최근 30일",
  "All time": "전체 기간",
  "No orders found": "주문 내역이 없습니다",
  "Upload a file": "파일 업로드",
  "Map columns": "열 연결",
  "Preview data": "데이터 미리보기",
  "Confirm import": "가져오기 확인",
  "Import complete": "가져오기 완료",
  "Categories": "카테고리",
  "Products": "상품",
  "Historical sales": "과거 판매 내역",
  "Category name": "카테고리명",
  "Age (optional)": "나이 (선택 사항)",
  "Gender (optional)": "성별 (선택 사항)",
  "Choose a file": "파일 선택",
  "Next": "다음",
  "Back": "뒤로",
  "Confirm": "확인",
  "Download template": "양식 다운로드",
  "View registered customers and their recent order history.": "등록된 고객과 최근 주문 내역을 확인하세요.",
  "Customers registered during checkout or imported into PointNull will appear here.": "체크아웃 중 등록하거나 PointNull로 가져온 고객이 여기에 표시됩니다.",
  "Manage customer information and understand customer activity.": "고객 정보를 관리하고 고객 활동을 확인하세요.",
  "Add Customer": "고객 추가",
  "Total Customers": "전체 고객 수",
  "Total Customer Spending": "고객 총 지출액",
  "Average Spending per Customer": "고객당 평균 지출액",
  "Matching transactions": "검색된 거래",
  "Final sales total": "최종 판매 금액",
  "Per transaction": "거래당",
  "Product units": "상품 수량",
  "Filter orders": "주문 필터",
  "Refine transactions by reference, customer, or date.": "주문 번호, 고객 또는 날짜로 거래를 검색하세요.",
  "Order ID": "주문 번호",
  "Customer name or phone": "고객 이름 또는 전화번호",
  "Sort by": "정렬 기준",
  "Newest first": "최신순",
  "Oldest first": "오래된순",
  "Highest amount": "금액 높은순",
  "Lowest amount": "금액 낮은순",
  "Quick date": "빠른 날짜 선택",
  "From": "시작",
  "To": "종료",
  "Sales transactions": "판매 거래",
  "Select an order to view its item details.": "주문을 선택하면 상품 상세 정보를 볼 수 있습니다.",
  "No transactions found": "거래 내역이 없습니다",
  "No orders match the current search and date filters. Reset the filters to view all transactions.": "현재 검색 및 날짜 조건에 맞는 주문이 없습니다. 모든 거래를 보려면 필터를 초기화하세요.",
  "Clear filters": "필터 초기화",
  "Total Revenue": "총 매출",
  "Average Order Value": "평균 주문 금액",
  "Total Items Sold": "총 판매 수량",
  "Filter sales by campaign used": "사용된 캠페인별 판매 필터",
  "Day of week": "요일",
  "Reset": "초기화",
  "matching orders": "건의 주문",
  "Net revenue": "순매출",
  "Average order value": "평균 주문 금액",
  "Items sold": "판매 수량",
  "Top product": "인기 상품",
  "Revenue over time": "기간별 매출",
  "Top 10 products by quantity": "판매 수량 상위 10개 상품",
  "No product sales in this period.": "이 기간에는 상품 판매가 없습니다.",
  "Product for units over time": "기간별 판매 수량 상품",
  "All matching products": "일치하는 모든 상품",
  "Units sold over time": "기간별 판매 수량",
  "Customer recommendations": "고객 추천",
  "Uses all purchase history and looks for new items bought by customers with similar purchases.": "전체 구매 내역을 분석하여 비슷한 구매 패턴을 가진 고객들이 새로 구매한 상품을 추천합니다.",
  "Customer": "고객",
  "Customers unavailable": "고객 정보를 사용할 수 없습니다",
  "Loading customers…": "고객 불러오는 중…",
  "Select a customer": "고객 선택",
  "No customers available": "등록된 고객이 없습니다",
  "Finding recommendations…": "추천 상품을 찾는 중…",
  "Suggested product": "추천 상품",
  "Similar customers": "유사 고객 수",
  "There is too little overlap in this customer’s linked purchase history to suggest a product.": "이 고객과 구매 내역이 비슷한 고객이 충분하지 않아 상품을 추천할 수 없습니다.",
  "Product": "상품",
  "Unit Price": "단가",
  "Qty": "수량",
  "No item details were found for this order.": "이 주문의 상품 상세 정보를 찾을 수 없습니다.",
  "Total items": "총 상품 수",
  "Campaign period": "캠페인 기간",
  "Running": "진행 중",
  "Finished": "종료됨",
  "Loading campaigns…": "캠페인 불러오는 중…",
  "Search by name or phone number": "이름 또는 전화번호 검색",
  "Total orders": "총 주문 수",
  "Total spending": "총 지출액",
  "customer": "명의 고객",
  "customers": "명의 고객",
  "No customer records have been added yet.": "아직 등록된 고객이 없습니다.",
  "Close customer form": "고객 양식 닫기",
  "Choose a PNG or JPEG image.": "PNG 또는 JPEG 이미지를 선택하세요.",
  "Image must be 5 MB or smaller.": "이미지 크기는 5MB 이하여야 합니다.",
  "Enter a product name, category, and valid price.": "상품명, 카테고리 및 올바른 가격을 입력하세요.",
  "Select a file to begin importing.": "가져오기를 시작하려면 파일을 선택하세요.",
  "Running (": "진행 중 (",
  "Finished (": "종료됨 (",

  "Try a different name or phone number, or add a new customer record.": "다른 이름이나 전화번호로 검색하거나 새 고객을 추가하세요.",
  "Phone Number": "전화번호",
  "Last Order Date": "최근 주문일",
  "Actions": "작업",
  "Previous": "이전",
  "Recent order history": "최근 주문 내역",
  "Orders linked to this phone number.": "이 전화번호에 연결된 주문입니다.",
  "No orders are linked to this customer yet.": "아직 이 고객과 연결된 주문이 없습니다.",
  "Edit Customer": "고객 수정",
  "Delete Customer": "고객 삭제",
  "This removes the customer record. Existing orders will remain in sales history but will no longer be linked to this customer.": "고객 정보가 삭제됩니다. 기존 주문은 판매 내역에 남지만 이 고객과의 연결은 해제됩니다.",
  "Campaign status": "캠페인 상태",
  "Campaigns will appear here based on their start and end dates.": "시작일과 종료일에 따라 캠페인이 여기에 표시됩니다.",
  "Linked orders": "연결된 주문",
  "Close": "닫기",
  "Order": "주문",
  "Date": "날짜",
  "Total": "합계",
  "No orders have used this campaign code yet.": "아직 이 캠페인 코드를 사용한 주문이 없습니다.",
  "Save": "저장",
  "Business setup": "비즈니스 설정",
  "Import existing data": "기존 데이터 가져오기",
  "What would you like to import?": "어떤 데이터를 가져오시겠습니까?",
  "Choose one record type. Product imports can create missing categories automatically. Customer imports check existing phone numbers for duplicates.": "가져올 데이터 유형을 선택하세요. 상품을 가져올 때 없는 카테고리는 자동으로 생성됩니다. 고객 가져오기는 기존 전화번호와 중복 여부를 확인합니다.",
  "Checking existing customer records…": "기존 고객 정보 확인 중…",
  "Drop your spreadsheet here": "스프레드시트를 여기에 놓으세요",
  "CSV or Excel (.xlsx)": "CSV 또는 Excel (.xlsx)",
  "Browse files": "파일 찾아보기",
  "Match your columns": "열 연결하기",
  "Tell PointNull what each spreadsheet column represents.": "각 스프레드시트 열이 어떤 정보를 나타내는지 지정하세요.",
  "Spreadsheet column": "스프레드시트 열",
  "Do not import": "가져오지 않음",
  "Data preview": "데이터 미리보기",
  "Invalid and duplicate rows will be skipped.": "잘못되었거나 중복된 행은 건너뜁니다.",
  "Row": "행",
  "Status": "상태",
  "Valid": "유효",
  "Ready to import": "가져올 준비 완료",
  "Review the records that will be added to your PointNull workspace.": "PointNull 작업 공간에 추가될 데이터를 확인하세요.",
  "Existing categories, products and customers are skipped. For product imports, any category name not already in PointNull will be created automatically. Historical sales and order-item imports are not available in this version.": "기존 카테고리, 상품 및 고객은 건너뜁니다. 상품을 가져올 때 PointNull에 없는 카테고리는 자동으로 생성됩니다. 현재 버전에서는 과거 판매 및 주문 항목을 가져올 수 없습니다.",
  "Your records are now part of the same PointNull dataset used by Sell and Analysis.": "가져온 데이터는 판매 및 분석에서 사용하는 PointNull 데이터에 추가되었습니다.",
  "Done": "완료",
  "Product imports can create missing categories automatically.": "상품 가져오기 시 누락된 카테고리를 자동으로 생성할 수 있습니다.",
  "Customer imports check existing phone numbers for duplicates.": "고객 가져오기는 기존 전화번호와 중복 여부를 확인합니다.",
  "Products included in this transaction.": "이 거래에 포함된 상품입니다.",
  "Sales analysis": "판매 분석",
  "Marketing analysis": "마케팅 분석",
  "All campaigns": "모든 캠페인",
  "No campaign code": "캠페인 코드 없음",
  "Download current view": "현재 화면 다운로드",
  "Downloads all available analytics without active filters.": "현재 필터 없이 전체 분석 데이터를 다운로드합니다.",
  "All selected dates": "선택한 전체 날짜",
  "Loading order items…": "주문 상품 불러오는 중…",
  "Transaction detail": "거래 상세 정보",
  "Order information": "주문 정보",
  "Date & time": "날짜 및 시간",
  "Guest customer": "일반 고객",
  "No customer linked": "연결된 고객 없음",
  "Total amount": "총 금액",
  "Close product form": "상품 양식 닫기",
  "Download full report": "전체 보고서 다운로드",
  "Age group": "연령대",
  "Calculating…": "계산 중…",
  "Campaign performance": "캠페인 성과",
  "Discount calculator": "할인 계산기",
  "Discounts": "할인액",
  "Known customers": "식별된 고객",
  "Least sold first": "판매량 낮은순",
  "Leave empty to skip the margin check": "마진 검사를 건너뛰려면 비워 두세요",
  "Most sold first": "판매량 높은순",
  "Net revenue by campaign": "캠페인별 순매출",
  "No campaigns overlap this period or have linked sales under these filters.": "이 기간과 필터에 해당하는 캠페인 또는 연결된 판매 내역이 없습니다.",
  "No discount fits the margin": "마진 기준에 맞는 할인이 없습니다",
  "No discount suggested": "추천 할인 없음",
  "No matching sales for this product.": "이 상품에 해당하는 판매 내역이 없습니다.",
  "Orders by campaign": "캠페인별 주문 수",
  "Planned budget": "예정 예산",
  "Product for demographics": "인구통계 분석 상품",
  "Product for discount": "할인 계산 상품",
  "Product rankings": "상품 순위",
  "Product sales by demographic": "인구통계별 상품 판매",
  "Rank": "순위",
  "Ranked by units sold in the selected period. Zero means no sales were recorded under these filters.": "선택한 기간의 판매 수량을 기준으로 순위를 매깁니다. 0은 현재 필터에서 판매가 없음을 의미합니다.",
  "Sales include matching items on orders linked to a campaign code. Budget is the planned amount for the whole campaign.": "캠페인 코드가 연결된 주문의 해당 상품 판매가 포함됩니다. 예산은 캠페인 전체에 계획된 금액입니다.",
  "Select a period with recorded sales to get a suggestion.": "추천을 받으려면 판매 기록이 있는 기간을 선택하세요.",
  "Select a product": "상품 선택",
  "Set a positive selling price before evaluating a discount.": "할인을 계산하기 전에 판매 가격을 0보다 크게 설정하세요.",
  "Sold units and performance ranking": "판매 수량 및 실적 순위",
  "Sort by units": "판매 수량순 정렬",
  "Suggest a discount": "할인 추천",
  "Suggested discount": "추천 할인",
  "Suggests a discount percentage from how the product is selling under the current filters: the further it sells below the typical product, the larger the discount. Add the unit cost to also keep the suggestion inside the margin target; it is not saved.": "현재 필터에서 상품 판매 실적을 바탕으로 할인율을 추천합니다. 일반적인 상품보다 판매량이 낮을수록 더 큰 할인을 제안합니다. 단가를 입력하면 목표 마진도 고려하며, 계산 결과는 저장되지 않습니다.",
  "There are no other products in this selection to compare sales against.": "현재 선택 항목에는 판매 실적을 비교할 다른 상품이 없습니다.",
  "This product is not part of the current filters.": "이 상품은 현재 필터에 포함되어 있지 않습니다.",
  "This product sells as well as or better than the typical product.": "이 상품은 일반 상품과 비슷하거나 더 좋은 판매 실적을 보입니다.",
  "Unit cost (₩), optional": "단가 (₩, 선택 사항)",
  "Units": "수량",
  "Units · Net revenue": "수량 · 순매출",
  "Unknown includes unlinked orders and missing profile fields. Groups reflect the current customer profile.": "알 수 없음에는 고객과 연결되지 않은 주문 및 프로필 정보가 누락된 주문이 포함됩니다. 그룹은 현재 고객 프로필을 기준으로 합니다.",
  "products · scroll for the full list": "개 상품 · 전체 목록을 스크롤하세요",
  "sold": "판매",
  "typical units": "일반 상품 판매량",
  "Items": "항목",
  "PointNull preferences": "PointNull 환경 설정",
  "Close settings": "설정 닫기",
  "Korean": "한국어",
  "PointNull": "PointNull",
  "Duplicate": "중복",
  "Missing": "누락",
  "Invalid": "잘못된 값",
  "Too long": "길이 초과",
  "categories added": "개 카테고리 추가",
  "products added": "개 상품 추가",
  "customers added": "명 고객 추가",
  "duplicate or invalid records skipped.": "개의 중복 또는 잘못된 데이터를 건너뛰었습니다.",
  "Continue": "계속",
  "Importing…": "가져오는 중…",
  "Rows detected": "감지된 행",
  "Duplicates": "중복",
  "Ready to map": "열 연결 준비 완료",
  "Choose a CSV or Excel (.xlsx) file.": "CSV 또는 Excel(.xlsx) 파일을 선택하세요.",
  "The selected file has no data rows.": "선택한 파일에 데이터 행이 없습니다.",
  "The file could not be read.": "파일을 읽을 수 없습니다.",
  "Existing customers could not be checked.": "기존 고객 정보를 확인할 수 없습니다.",
  "Exporting…": "내보내는 중…",
  "Preparing current view…": "현재 화면을 준비하는 중…",
  "Preparing full report…": "전체 보고서를 준비하는 중…",
  "Export failed. Please try again.": "내보내기에 실패했습니다. 다시 시도하세요.",
  "downloaded": "다운로드 완료",
  "Explore sales, customers, and campaign performance.": "매출, 고객 및 캠페인 성과를 확인하세요.",
  "Analysis view": "분석 보기",
  "Date range": "기간",
  "Campaign used": "사용한 캠페인",
  "Group by": "그룹 기준",
  "Daily": "일별",
  "Weekly": "주별",
  "Monthly": "월별",
  "Yearly": "연별",
  "Time of day": "시간대",
  "to": "~",
  "Monday": "월요일",
  "Tuesday": "화요일",
  "Wednesday": "수요일",
  "Thursday": "목요일",
  "Friday": "금요일",
  "Saturday": "토요일",
  "Sunday": "일요일",
  "Export report": "보고서 내보내기",
  "Uses the selected date range, days, times, and categories.": "선택한 기간, 요일, 시간 및 카테고리를 사용합니다.",
  "Could not load sales report": "판매 보고서를 불러오지 못했습니다",
  "No sales match these filters": "필터에 해당하는 판매 내역이 없습니다",
  "Adjust the filters or complete a new sale to see analytics.": "필터를 조정하거나 새 판매를 완료하면 분석 결과를 확인할 수 있습니다.",
  "Revenue by hour": "시간대별 매출",
  "Revenue by day of week": "요일별 매출",
  "Sales by category": "카테고리별 판매",
  "Period for product bars": "상품별 판매 차트 기간",
  "Hover or tap the chart to see the value for a period.": "차트에 마우스를 올리거나 탭하면 해당 기간의 값을 확인할 수 있습니다.",
  "weeks start Monday": "주간은 월요일부터 시작합니다",
  "Week of": "주간 시작",
  "net revenue": "순매출",
  "units sold": "판매 수량",
  "Daily net revenue": "일별 순매출",
  "Weekly net revenue": "주별 순매출",
  "Monthly net revenue": "월별 순매출",
  "Yearly net revenue": "연별 순매출",
  "Daily units sold": "일별 판매 수량",
  "Weekly units sold": "주별 판매 수량",
  "Monthly units sold": "월별 판매 수량",
  "Yearly units sold": "연별 판매 수량",
  "Inspect": "확인",
  "Revenue by category": "카테고리별 매출",
  "7d": "7일",
  "30d": "30일",
  "Category name (or ID)": "카테고리명(또는 ID)",
  "Source Product ID": "원본 상품 ID",
  "Order / Transaction ID": "주문 / 거래 ID",
  "Order date": "주문 날짜",
  "Order time": "주문 시간",
  "Product ID": "상품 ID",
  "Quantity": "수량",
  "Item price": "상품 가격",
  "Import menu groups and sections": "메뉴 그룹 및 섹션 가져오기",
  "Import items, prices, and categories": "상품, 가격 및 카테고리 가져오기",
  "Import customer names and phone numbers": "고객 이름 및 전화번호 가져오기",
  "Past transactions and totals": "과거 거래 및 합계",
  "Products and quantities per order": "주문별 상품 및 수량",
  "Coming later": "추후 제공",
  "max 100 characters": "최대 100자",
  "max 50 characters": "최대 50자",
  "max 20 characters": "최대 20자",
  "of": "중",
  "matching orders are linked to a customer. Age is known for": "건은 고객과 연결되어 있습니다. 연령 정보가 확인된 주문은",
  "orders and gender for": "건이며, 성별 정보가 확인된 주문은",
  "{count} order totals disagree with item subtotals minus discounts; analytics uses item amounts minus allocated discounts.": "주문 합계 {count}건이 할인 후 상품 소계와 일치하지 않아, 분석에는 할인 배분 후 상품 금액을 사용합니다.",
  "{identified} of {orders} matching orders are linked to a customer. Age is known for {ageOrders} orders and gender for {genderOrders}.": "전체 {orders}건 중 {identified}건의 주문이 고객과 연결되어 있습니다. 연령 정보가 확인된 주문은 {ageOrders}건이며, 성별 정보가 확인된 주문은 {genderOrders}건입니다.",
  "Close import": "가져오기 닫기",
  "Map": "연결",
  "Upload": "업로드",
  "Review": "검토",
  "Female": "여성",
  "Male": "남성",
  "Unknown": "알 수 없음",
};

const categoryKo: Record<number, { en: string; ko: string }> = {
  1: { en: "Rice Bowls", ko: "덮밥류" },
  2: { en: "Soups & Stews", ko: "국 & 찌개" },
  3: { en: "Noodles", ko: "면류" },
  4: { en: "Grill & BBQ", ko: "구이 & 바비큐" },
  5: { en: "Street Food", ko: "길거리 음식" },
  6: { en: "Sides", ko: "사이드 메뉴" },
  7: { en: "Drinks", ko: "음료" },
};

const productKo: Record<number, { en: string; ko: string }> = {
  1: { en: "Bulgogi Rice Bowl", ko: "불고기 덮밥" },
  2: { en: "Spicy Pork Rice Bowl", ko: "제육 덮밥" },
  3: { en: "Chicken Teriyaki Bowl", ko: "치킨 데리야끼 덮밥" },
  4: { en: "Beef Bibimbap", ko: "소고기 비빔밥" },
  5: { en: "Kimchi Fried Rice", ko: "김치볶음밥" },
  6: { en: "Kimchi Jjigae", ko: "김치찌개" },
  7: { en: "Soft Tofu Stew", ko: "순두부찌개" },
  8: { en: "Beef Doenjang Stew", ko: "소고기 된장찌개" },
  9: { en: "Budae Jjigae", ko: "부대찌개" },
  10: { en: "Samgyetang", ko: "삼계탕" },
  11: { en: "Jajangmyeon", ko: "짜장면" },
  12: { en: "Jjamppong", ko: "짬뽕" },
  13: { en: "Japchae", ko: "잡채" },
  14: { en: "Cold Buckwheat Noodles", ko: "냉메밀국수" },
  15: { en: "Kalguksu", ko: "칼국수" },
  16: { en: "Pork Belly Set", ko: "삼겹살 세트" },
  17: { en: "Beef Galbi", ko: "소갈비" },
  18: { en: "Spicy Chicken Galbi", ko: "매운 닭갈비" },
  19: { en: "Grilled Mackerel", ko: "고등어구이" },
  20: { en: "Bulgogi Platter", ko: "불고기 모둠" },
  21: { en: "Tteokbokki", ko: "떡볶이" },
  22: { en: "Cheese Tteokbokki", ko: "치즈 떡볶이" },
  23: { en: "Gimbap", ko: "김밥" },
  24: { en: "Korean Fried Chicken", ko: "한국식 프라이드 치킨" },
  25: { en: "Fish Cake Skewers", ko: "어묵꼬치" },
  26: { en: "Kimchi Pancake", ko: "김치전" },
  27: { en: "Seafood Pancake", ko: "해물파전" },
  28: { en: "Steamed Egg", ko: "계란찜" },
  29: { en: "Mandu Dumplings", ko: "만두" },
  30: { en: "Japchae Side", ko: "잡채 (사이드)" },
  31: { en: "Iced Americano", ko: "아이스 아메리카노" },
  32: { en: "Sikhye", ko: "식혜" },
  33: { en: "Barley Tea", ko: "보리차" },
  34: { en: "Citron Tea", ko: "유자차" },
  35: { en: "Soda", ko: "탄산음료" },
};

interface PreferencesValue {
  language: AppLanguage;
  theme: AppTheme;
  currency: AppCurrency;
  displaySize: AppDisplaySize;
  appMode: AppMode;
  exchangeRateStatus: ExchangeRateStatus;
  exchangeRateDate: string;
  exchangeRateError: string;
  setLanguage: (language: AppLanguage) => void;
  setTheme: (theme: AppTheme) => void;
  setCurrency: (currency: AppCurrency) => void;
  setDisplaySize: (size: AppDisplaySize) => void;
  setAppMode: (mode: AppMode) => void;
  formatMoney: (amountInKrw: number) => string;
  t: (key: string) => string;
  productName: (productId: number, sourceName: string) => string;
  categoryName: (categoryId: number, sourceName: string) => string;
  categoryLabel: (sourceName: string) => string;
}

const PreferencesContext = createContext<PreferencesValue | null>(null);

function storedLanguage(): AppLanguage {
  try {
    return localStorage.getItem(LANGUAGE_KEY) === "ko" ? "ko" : "en";
  } catch {
    return "en";
  }
}


interface CachedExchangeRates {
  rates: ExchangeRates;
  date: string;
  fetchedAt: number;
}

function readCachedExchangeRates(): CachedExchangeRates | null {
  try {
    const raw = localStorage.getItem(FX_CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as CachedExchangeRates;
    if (
      !cached ||
      !cached.date ||
      !Number.isFinite(cached.fetchedAt) ||
      !Number.isFinite(cached.rates?.USD) ||
      !Number.isFinite(cached.rates?.MYR) ||
      Number(cached.rates.USD) <= 0 ||
      Number(cached.rates.MYR) <= 0
    ) return null;
    return cached;
  } catch {
    return null;
  }
}

function storedCurrency(): AppCurrency {
  try {
    const saved = localStorage.getItem(CURRENCY_KEY);
    if (saved === "KRW") return "KRW";
    if ((saved === "USD" || saved === "MYR") && readCachedExchangeRates()) return saved;
    return "KRW";
  } catch {
    return "KRW";
  }
}

function storedAppMode(): AppMode {
  try {
    const saved = localStorage.getItem(APP_MODE_KEY);
    if (saved === "simple" || saved === "advanced") return saved;

    // Preserve the full workspace for existing installations upgrading to this version.
    // A clean first-time installation starts in Simple Mode.
    const hasExistingPreferences = [LANGUAGE_KEY, THEME_KEY, CURRENCY_KEY, DISPLAY_SIZE_KEY]
      .some((key) => localStorage.getItem(key) !== null);
    return hasExistingPreferences ? "advanced" : "simple";
  } catch {
    return "simple";
  }
}

function storedDisplaySize(): AppDisplaySize {
  try {
    const saved = localStorage.getItem(DISPLAY_SIZE_KEY);
    return saved === "compact" || saved === "large" ? saved : "default";
  } catch {
    return "default";
  }
}

function storedTheme(): AppTheme {
  try {
    return localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<AppLanguage>(storedLanguage);
  const [theme, setTheme] = useState<AppTheme>(storedTheme);
  const [currency, setCurrencyState] = useState<AppCurrency>(storedCurrency);
  const [displaySize, setDisplaySize] = useState<AppDisplaySize>(storedDisplaySize);
  const [appMode, setAppModeState] = useState<AppMode>(storedAppMode);
  const [cachedAtStart] = useState<CachedExchangeRates | null>(readCachedExchangeRates);
  const [exchangeRates, setExchangeRates] = useState<ExchangeRates>(() => cachedAtStart?.rates ?? { KRW: 1 });
  const [exchangeRateDate, setExchangeRateDate] = useState(cachedAtStart?.date ?? "");
  const [exchangeRateStatus, setExchangeRateStatus] = useState<ExchangeRateStatus>(cachedAtStart ? "ready" : "loading");
  const [exchangeRateError, setExchangeRateError] = useState("");

  useEffect(() => {
    try { localStorage.setItem(LANGUAGE_KEY, language); } catch { /* Storage may be unavailable. */ }
    document.documentElement.lang = language;
  }, [language]);

  useEffect(() => {
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* Storage may be unavailable. */ }
    document.documentElement.classList.toggle("theme-dark", theme === "dark");
    document.body.style.colorScheme = theme;
  }, [theme]);

  useEffect(() => {
    try { localStorage.setItem(DISPLAY_SIZE_KEY, displaySize); } catch { /* Storage may be unavailable. */ }
    document.documentElement.dataset.displaySize = displaySize;
  }, [displaySize]);

  useEffect(() => {
    try { localStorage.setItem(APP_MODE_KEY, appMode); } catch { /* Storage may be unavailable. */ }
  }, [appMode]);

  useEffect(() => {
    let active = true;
    const cached = cachedAtStart;

    if (cached && Date.now() - cached.fetchedAt < FX_CACHE_TTL) {
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);

    fetch("https://api.frankfurter.dev/v2/rates?base=KRW&quotes=USD,MYR", {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Exchange-rate service returned ${response.status}.`);
        return response.json() as Promise<Array<{ date: string; base: string; quote: string; rate: number }>>;
      })
      .then((rows) => {
        const nextRates: ExchangeRates = { KRW: 1 };
        let date = "";
        for (const row of rows) {
          if (row.base !== "KRW" || !Number.isFinite(row.rate) || row.rate <= 0) continue;
          if (row.quote === "USD" || row.quote === "MYR") nextRates[row.quote] = row.rate;
          date = row.date || date;
        }
        if (!nextRates.USD || !nextRates.MYR || !date) {
          throw new Error("The exchange-rate service did not return all requested currencies.");
        }
        if (!active) return;
        const cachedRates: CachedExchangeRates = { rates: nextRates, date, fetchedAt: Date.now() };
        setExchangeRates(nextRates);
        setExchangeRateDate(date);
        setExchangeRateStatus("ready");
        setExchangeRateError("");
        try { localStorage.setItem(FX_CACHE_KEY, JSON.stringify(cachedRates)); } catch { /* Cache is optional. */ }
      })
      .catch(() => {
        if (!active) return;
        if (cached) {
          setExchangeRates(cached.rates);
          setExchangeRateDate(cached.date);
          setExchangeRateStatus("ready");
          setExchangeRateError("Using saved exchange rates because the latest rates could not be loaded.");
        } else {
          setExchangeRates({ KRW: 1 });
          setExchangeRateStatus("error");
          setExchangeRateError("Exchange rates are unavailable. KRW remains selected.");
          setCurrencyState("KRW");
          try { localStorage.setItem(CURRENCY_KEY, "KRW"); } catch { /* Storage may be unavailable. */ }
        }
      })
      .finally(() => window.clearTimeout(timeout));

    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [cachedAtStart]);

  const setAppMode = useCallback((nextMode: AppMode) => setAppModeState(nextMode), []);

  const setCurrency = useCallback((nextCurrency: AppCurrency) => {
    if (nextCurrency !== "KRW" && !exchangeRates[nextCurrency]) return;
    setCurrencyState(nextCurrency);
    try { localStorage.setItem(CURRENCY_KEY, nextCurrency); } catch { /* Storage may be unavailable. */ }
  }, [exchangeRates]);

  const displayCurrency: AppCurrency = currency !== "KRW" && !exchangeRates[currency] ? "KRW" : currency;
  const displayRate = displayCurrency === "KRW" ? 1 : Number(exchangeRates[displayCurrency]);
  const displayLocale = language === "ko"
    ? "ko-KR"
    : displayCurrency === "MYR"
      ? "en-MY"
      : "en-US";
  const moneyFormatter = useMemo(() => new Intl.NumberFormat(displayLocale, {
    style: "currency",
    currency: displayCurrency,
    minimumFractionDigits: displayCurrency === "KRW" ? 0 : 2,
    maximumFractionDigits: displayCurrency === "KRW" ? 0 : 2,
  }), [displayCurrency, displayLocale]);
  const formatMoney = useCallback((amountInKrw: number) => {
    const amount = Number.isFinite(amountInKrw) ? amountInKrw * displayRate : 0;
    return moneyFormatter.format(amount);
  }, [displayRate, moneyFormatter]);

  const t = useCallback((key: string) => language === "ko" ? (ko[key] ?? key) : key, [language]);
  const productName = useCallback((productId: number, sourceName: string) => {
    if (language !== "ko") return sourceName;
    const translation = productKo[productId];
    return translation && translation.en.toLocaleLowerCase() === sourceName.trim().toLocaleLowerCase()
      ? translation.ko
      : sourceName;
  }, [language]);
  const categoryName = useCallback((categoryId: number, sourceName: string) => {
    if (language !== "ko") return sourceName;
    const translation = categoryKo[categoryId];
    return translation && translation.en.toLocaleLowerCase() === sourceName.trim().toLocaleLowerCase()
      ? translation.ko
      : sourceName;
  }, [language]);

  const categoryLabel = useCallback((sourceName: string) => {
    if (language !== "ko") return sourceName;
    const match = Object.values(categoryKo).find((entry) => entry.en.toLocaleLowerCase() === sourceName.trim().toLocaleLowerCase());
    return match?.ko ?? sourceName;
  }, [language]);

  const value = useMemo(() => ({ language, theme, currency, displaySize, appMode, exchangeRateStatus, exchangeRateDate, exchangeRateError, setLanguage, setTheme, setCurrency, setDisplaySize, setAppMode, formatMoney, t, productName, categoryName, categoryLabel }), [language, theme, currency, displaySize, appMode, exchangeRateStatus, exchangeRateDate, exchangeRateError, setCurrency, setAppMode, formatMoney, t, productName, categoryName, categoryLabel]);
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesValue {
  const value = useContext(PreferencesContext);
  if (!value) throw new Error("usePreferences must be used within PreferencesProvider.");
  return value;
}
