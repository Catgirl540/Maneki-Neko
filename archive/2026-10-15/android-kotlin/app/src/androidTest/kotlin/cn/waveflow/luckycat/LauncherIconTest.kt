package cn.waveflow.luckycat

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.drawable.AdaptiveIconDrawable
import androidx.core.content.ContextCompat
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.*
import org.junit.Test
import java.io.File

class LauncherIconTest {
    @Test fun manifestUsesAdaptiveBrandAndArtworkRenders() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val icon = context.packageManager.getApplicationIcon(context.packageName)
        assertTrue(icon is AdaptiveIconDrawable)
        val cat = ContextCompat.getDrawable(context, R.drawable.brand_cat)!!
        val bitmap = Bitmap.createBitmap(256,256,Bitmap.Config.ARGB_8888)
        cat.setBounds(0,0,256,256); cat.draw(Canvas(bitmap))
        assertTrue(bitmap.getPixel(128,144) ushr 24 > 0)
        // Eyes stay transparent rather than becoming painted cream circles.
        assertEquals(0, bitmap.getPixel(102,133) ushr 24)
        val sheet = Bitmap.createBitmap(720,320,Bitmap.Config.ARGB_8888)
        val canvas = Canvas(sheet); canvas.drawColor(0xFFF7F5F0.toInt())
        cat.setBounds(50,30,250,230); cat.draw(canvas)
        icon.setBounds(420,40,600,220); icon.draw(canvas)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFF0E1B26.toInt(); textSize = 24f }
        canvas.drawText("luckycat BANK", 60f, 275f, paint)
        canvas.drawText("招财猫银行", 448f, 275f, paint)
        File(context.getExternalFilesDir(null), "icon-preview.png").outputStream().use { sheet.compress(Bitmap.CompressFormat.PNG,100,it) }
    }
}
