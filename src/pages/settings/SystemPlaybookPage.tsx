export default function SystemPlaybookPage() {
  return (
    <div className="p-6 max-w-5xl mx-auto" dir="rtl">
      {/* ⚠️ تنبيه هام لأي مطور (DEVELOPER WARNING): 
          أي إعداد جديد يتم إضافته للنظام يجب توثيقه في هذا الملف فوراً. 
          هذا الملف هو الدليل الحي (Living Documentation) لمدير المطعم.
          لا تقم بإنهاء أي مهمة تخص الإعدادات قبل تحديث هذا الملف!
      */}
      
      <div className="mb-8 border-b pb-4">
        <h1 className="text-3xl font-bold text-gray-800 mb-2">📖 الدليل التشغيلي الشامل (Playbook)</h1>
        <p className="text-gray-600 text-lg">
          هذا الدليل يشرح التسلسل المنطقي لبناء النظام، وتأثير كل إعداد على سير العمل.
          <br/>
          <span className="text-sm text-blue-600 font-semibold">يُحدّث هذا الدليل تلقائياً مع كل إصدار جديد لضمان دقة المعلومات بنسبة 100%.</span>
        </p>
      </div>

      <div className="space-y-8">
        
        {/* 1. المنشأ والأساس */}
        <section className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <h2 className="text-2xl font-bold text-blue-800 mb-4 border-b pb-2">1. المنشأ والأساس (Foundation & Venue)</h2>
          <p className="text-gray-700 mb-4">هذه هي الخطوة "الصفرية". بدونها لا يوجد مطعم في النظام.</p>
          
          <div className="space-y-4">
            <div className="bg-gray-50 p-4 rounded border border-gray-100">
              <h3 className="font-bold text-lg text-gray-800">1.1 إعدادات الفروع والصالات (Venue & Floors)</h3>
              <p className="text-gray-600 mt-1"><strong>التأثير:</strong> تُبنى عليها خريطة الطاولات (Tables Layout).</p>
              <p className="text-red-600 text-sm mt-1"><strong>ماذا لو لم تُعد؟</strong> لن تظهر أي خريطة للكابتن، ولن يتمكن من تسكين أي عميل.</p>
            </div>

            <div className="bg-gray-50 p-4 rounded border border-gray-100">
              <h3 className="font-bold text-lg text-gray-800">1.2 الطاولات والحد الأدنى (Tables & Minimum Charge)</h3>
              <p className="text-gray-600 mt-1"><strong>التأثير:</strong> عند فتح "جلسة"، يقرأ النظام الحد الأدنى. إذا كان عدد الضيوف 4 والحد الأدنى 50، النظام يفرض 200 كحد أدنى للفاتورة.</p>
              <p className="text-red-600 text-sm mt-1"><strong>ماذا لو لم يُحدد؟</strong> سيُسمح للعميل بحجز طاولة مزدحمة وطلب كوب ماء فقط دون أي قيود مالية.</p>
            </div>

            <div className="bg-gray-50 p-4 rounded border border-gray-100">
              <h3 className="font-bold text-lg text-gray-800">1.3 طاولات الـ VIP والمالك</h3>
              <p className="text-gray-600 mt-1"><strong>التأثير:</strong> تطبق الخصومات تلقائياً (إعفاء ضريبة/خدمة) بمجرد جلوس المالك.</p>
              <p className="text-red-600 text-sm mt-1"><strong>ماذا لو لم تُعد؟</strong> سيضطر الكاشير لعمل خصم يدوي، مما يفتح باباً للتلاعب ويتطلب موافقة مدير تعطل العمل.</p>
            </div>
          </div>
        </section>

        {/* 2. الأصناف والمنيو */}
        <section className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <h2 className="text-2xl font-bold text-blue-800 mb-4 border-b pb-2">2. الأصناف والمنيو (Items & Menu)</h2>
          <p className="text-gray-700 mb-4">هذا القسم هو "قلب" المبيعات. أي خطأ هنا يوقف قدرة الكابتن على أخذ الطلبات.</p>
          
          <div className="space-y-4">
            <div className="bg-gray-50 p-4 rounded border border-gray-100">
              <h3 className="font-bold text-lg text-gray-800">2.1 المنيو اليومي (Daily Menu)</h3>
              <p className="text-gray-600 mt-1"><strong>التأثير:</strong> هي القائمة التي تظهر في شاشة الكابتن.</p>
              <p className="text-red-600 text-sm mt-1"><strong>ماذا لو كان فارغاً؟</strong> شاشة الطلبات ستكون بيضاء تماماً.</p>
            </div>

            <div className="bg-gray-50 p-4 rounded border border-gray-100">
              <h3 className="font-bold text-lg text-gray-800">2.2 تصنيفات عرض المنيو (Categories)</h3>
              <p className="text-gray-600 mt-1"><strong>التأثير:</strong> تنظيم الشاشة لتسريع وصول الكابتن للصنف.</p>
              <p className="text-red-600 text-sm mt-1"><strong>ماذا لو لم تُحدد؟</strong> ستظهر مئات الأصناف في قائمة واحدة طويلة، مما يبطئ عملية أخذ الطلب.</p>
            </div>

            <div className="bg-gray-50 p-4 rounded border border-gray-100">
              <h3 className="font-bold text-lg text-gray-800">2.3 إعدادات الشرائح (Wizard)</h3>
              <p className="text-gray-600 mt-1"><strong>التأثير:</strong> إجبار الكابتن على المرور بنوافذ متسلسلة (مثل: اختر درجة السواء).</p>
              <p className="text-red-600 text-sm mt-1"><strong>ماذا لو لم يُفعل؟</strong> سينسى الكابتن سؤال العميل، وسيرفض المطبخ الطلب لعدم وضوحه.</p>
            </div>

            <div className="bg-gray-50 p-4 rounded border border-gray-100">
              <h3 className="font-bold text-lg text-gray-800">2.4 بروفايلات الأصناف وتوجيه المطبخ</h3>
              <p className="text-gray-600 mt-1"><strong>التأثير:</strong> ربط الصنف بمحطة تحضير (العصير للبار، اللحم للمشويات).</p>
              <p className="text-red-600 text-sm mt-1"><strong>ماذا لو لم يُربط؟</strong> سيُرسل الطلب، لكنه لن يظهر في أي شاشة KDS ولن يُطبع! سينتظر العميل للأبد.</p>
            </div>
          </div>
        </section>

        {/* 3. المطبخ والإنتاج */}
        <section className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 mt-8">
          <h2 className="text-2xl font-bold text-blue-800 mb-4 border-b pb-2">3. المطبخ والإنتاج (Kitchen & Production)</h2>
          
          <div className="space-y-4">
            <div className="bg-gray-50 p-4 rounded border border-gray-100">
              <h3 className="font-bold text-lg text-gray-800">3.1 شاشات KDS مقابل الطابعات</h3>
              <p className="text-gray-600 mt-1"><strong>التأثير:</strong> يحدد طريقة استلام المطبخ للطلبات (شاشات رقمية أو طابعات ورقية).</p>
              <p className="text-red-600 text-sm mt-1"><strong>ماذا لو ضُبط بشكل خاطئ؟</strong> ستضيع الطلبات ولن يبدأ التحضير.</p>
            </div>
            <div className="bg-gray-50 p-4 rounded border border-gray-100">
              <h3 className="font-bold text-lg text-gray-800">3.2 إيقاف صنف من المطبخ (Out of Stock)</h3>
              <p className="text-gray-600 mt-1"><strong>التأثير:</strong> يظهر الصنف للكابتن باللون الرمادي فوراً.</p>
              <p className="text-red-600 text-sm mt-1"><strong>ماذا لو لم يُستخدم؟</strong> سيطلب الكابتن الصنف، ثم يعود للاعتذار للعميل بعد أن يرفضه المطبخ.</p>
            </div>
          </div>
        </section>
        {/* 4. دورة العمل والأدوار */}
        <section className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 mt-8">
          <h2 className="text-2xl font-bold text-blue-800 mb-4 border-b pb-2">4. دورة العمل والأدوار (Workflow & Roles)</h2>
          
          <div className="space-y-4">
            <div className="bg-gray-50 p-4 rounded border border-gray-100">
              <h3 className="font-bold text-lg text-gray-800">4.1 حصرية الطاولة (Exclusive Table)</h3>
              <p className="text-gray-600 mt-1"><strong>التأثير:</strong> الكابتن الذي فتح الطاولة هو الوحيد الذي يستطيع إضافة طلبات عليها.</p>
              <p className="text-red-600 text-sm mt-1"><strong>ماذا لو أُوقفت؟</strong> قد تتداخل الطلبات بين الكباتن وتحدث مشاكل في حساب العمولات.</p>
            </div>
          </div>
        </section>
        {/* 5. السياسات المالية */}
        <section className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 mt-8">
          <h2 className="text-2xl font-bold text-blue-800 mb-4 border-b pb-2">5. السياسات المالية (Financial Policies)</h2>
          
          <div className="space-y-4">
            <div className="bg-gray-50 p-4 rounded border border-gray-100">
              <h3 className="font-bold text-lg text-gray-800">5.1 الضرائب والخدمة</h3>
              <p className="text-gray-600 mt-1"><strong>التأثير:</strong> حساب الضريبة قبل أو بعد الخصم.</p>
              <p className="text-red-600 text-sm mt-1"><strong>ماذا لو ضُبطت بشكل خاطئ؟</strong> فواتير غير مطابقة لهيئة الزكاة/الضرائب، وغرامات مالية.</p>
            </div>
          </div>
        </section>
        {/* 6. حركة الطاولات والضيوف */}
        <section className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 mt-8">
          <h2 className="text-2xl font-bold text-blue-800 mb-4 border-b pb-2">6. الدمج والتحويل وإعادة التوزيع</h2>
          <div className="space-y-4">
            <div className="bg-gray-50 p-4 rounded border border-gray-100">
              <h3 className="font-bold text-lg text-gray-800">6.1 دمج الطاولات</h3>
              <p className="text-gray-600 mt-1"><strong>المعنى:</strong> تظل الطاولتان مفتوحتين لاستقبال الطلبات، لكن الحساب النهائي يُطلب من الطاولة الهدف ويشمل طلبات الجميع.</p>
              <p className="text-amber-700 text-sm mt-1"><strong>هدف مشغول:</strong> يظهر تحذير صريح بأن حسابه الحالي سيصبح الحساب المشترك. هدف فارغ: يُشغّل تلقائياً.</p>
              <p className="text-gray-600 text-sm mt-1"><strong>العلامات:</strong> تظهر على المصدر «مدموجة مع… الحساب هناك»، وعلى الهدف «حساب مشترك مع…».</p>
            </div>
            <div className="bg-gray-50 p-4 rounded border border-gray-100">
              <h3 className="font-bold text-lg text-gray-800">6.2 فك الدمج</h3>
              <p className="text-gray-600 mt-1">متاح قبل طلب الحساب فقط. يعرض أصناف الطاولتين ومقاعدها، ثم يعيد كل جلسة إلى طاولتها الأصلية مع إمكانية تصحيح توزيع المقاعد.</p>
              <p className="text-red-600 text-sm mt-1"><strong>بعد طلب الحساب:</strong> لا يمكن فك الدمج حتى لا تتغير مكونات فاتورة تم إصدارها.</p>
            </div>
            <div className="bg-gray-50 p-4 rounded border border-gray-100">
              <h3 className="font-bold text-lg text-gray-800">6.3 تحويل طاولة كاملة</h3>
              <p className="text-gray-600 mt-1">الطاولة المصدر تدخل دورة التنظيف. إذا كان الهدف فارغاً تنتقل إليه الجلسة، وإذا كان مشغولاً تُضم إليه الطلبات والضيوف ويصبح حساب الهدف هو الحساب الكامل بعد التأكيد.</p>
            </div>
            <div className="bg-gray-50 p-4 rounded border border-gray-100">
              <h3 className="font-bold text-lg text-gray-800">6.4 إعادة التوزيع وفصل ضيف</h3>
              <p className="text-gray-600 mt-1">يمكن تصحيح مقعد صنف داخل الطاولة نفسها، أو اختيار بنود مرسلة ونقلها إلى طاولة فارغة أو مشغولة مع تحديد مقاعدها الجديدة.</p>
              <p className="text-gray-600 text-sm mt-1">خيار «فصل ضيف كامل» ينقص عدد ضيوف المصدر ويزيد عدد ضيوف الهدف؛ اتركه غير محدد عند تصحيح بند فقط.</p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
