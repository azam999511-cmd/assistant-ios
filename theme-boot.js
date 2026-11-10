/* يطبّق الثيم قبل أول رسم، عشان لون شريط الحالة وخلفية الصفحة يطلعون صح من أول لحظة */
try { var t = localStorage.getItem('mu.theme'); if (t) document.documentElement.dataset.theme = t; } catch (e) {}
