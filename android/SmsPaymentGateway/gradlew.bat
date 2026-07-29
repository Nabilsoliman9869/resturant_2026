@ECHO OFF
SET JAVA_HOME=E:\XTRA_WEB\?????\tools\jdk17
SET PATH=%JAVA_HOME%\bin;%PATH%
SET DIR=%~dp0
"%JAVA_HOME%\bin\java.exe" -classpath "%DIR%gradle\wrapper\gradle-wrapper.jar" org.gradle.wrapper.GradleWrapperMain %*
